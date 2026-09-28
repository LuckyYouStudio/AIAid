import { randomUUID } from 'node:crypto';
import { and, count, desc, eq, gte, or, isNull } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import type { Tenant, User } from '../db/schema.js';
import { buildSystemPrompt } from '../llm/prompt.js';
import { config } from '../config.js';

export interface NotifyConfig {
  channel?: 'console' | 'telegram' | 'email';
  email?: string;
  telegram?: { botToken?: string; chatId?: string };
  replySla?: string;
}

export interface WidgetConfig {
  title?: string;
  color?: string;
  greeting?: string;
  position?: 'right' | 'left';
}

export interface TenantInput {
  name: string;
  ownerName: string;
  ownerDescription: string;
  extraRules: string;
  replySla: string;
  websiteUrl: string;
  knowledgeMd: string;
  bookingUrl: string;
  notify: NotifyConfig;
  widget: WidgetConfig;
  allowedOrigins: string[];
}

export function parseJson<T>(s: string | null | undefined, fallback: T): T {
  try {
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** URL-safe id from a name, plus a short random suffix to avoid collisions. */
export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  return `${base || 'assistant'}-${randomUUID().slice(0, 6)}`;
}

function normalizeOrigins(list: string[]): string[] {
  const out = new Set<string>();
  for (const raw of list) {
    const s = raw.trim();
    if (!s) continue;
    try {
      const u = new URL(s.includes('://') ? s : `https://${s}`);
      out.add(u.origin);
    } catch {
      /* skip invalid */
    }
  }
  return [...out];
}

export function tenantRow(input: TenantInput, extra: { id: string; ownerUserId: string | null; createdAt: Date; monthlyLimit: number }) {
  const notify: NotifyConfig = { ...input.notify, replySla: input.replySla };
  return {
    id: extra.id,
    name: input.name.trim() || 'My assistant',
    ownerUserId: extra.ownerUserId,
    ownerName: input.ownerName.trim(),
    ownerDescription: input.ownerDescription.trim(),
    extraRules: input.extraRules.trim(),
    replySla: input.replySla.trim() || 'within 24 hours',
    websiteUrl: input.websiteUrl.trim(),
    systemPrompt: buildSystemPrompt({
      ownerName: input.ownerName.trim() || input.name.trim(),
      replySla: input.replySla.trim() || 'within 24 hours',
      ownerDescription: input.ownerDescription.trim() || undefined,
      extraRules: input.extraRules
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => (l.startsWith('-') ? l : `- ${l}`))
        .join('\n'),
    }),
    knowledgeMd: input.knowledgeMd,
    bookingUrl: input.bookingUrl.trim(),
    notifyConfig: JSON.stringify(notify),
    widgetConfig: JSON.stringify(input.widget),
    allowedOrigins: JSON.stringify(normalizeOrigins(input.allowedOrigins)),
    monthlyLimit: extra.monthlyLimit,
    createdAt: extra.createdAt,
  };
}

export async function createTenant(user: User, input: TenantInput): Promise<Tenant> {
  const row = tenantRow(input, {
    id: slugify(input.name),
    ownerUserId: user.id,
    createdAt: new Date(),
    monthlyLimit: user.role === 'admin' ? 0 : config.limits.monthlyPerTenant,
  });
  await db.insert(schema.tenants).values(row).run();
  return (await db.select().from(schema.tenants).where(eq(schema.tenants.id, row.id)).get())!;
}

export async function updateTenant(existing: Tenant, input: TenantInput): Promise<void> {
  const row = tenantRow(input, {
    id: existing.id,
    ownerUserId: existing.ownerUserId,
    createdAt: existing.createdAt,
    monthlyLimit: existing.monthlyLimit,
  });
  await db.update(schema.tenants).set(row).where(eq(schema.tenants.id, existing.id)).run();
}

export async function deleteTenant(id: string): Promise<void> {
  // Messages reference conversations; leads reference conversations; delete in order.
  await db.delete(schema.messages).where(eq(schema.messages.tenantId, id)).run();
  await db.delete(schema.leads).where(eq(schema.leads.tenantId, id)).run();
  await db.delete(schema.conversations).where(eq(schema.conversations.tenantId, id)).run();
  await db.delete(schema.tenants).where(eq(schema.tenants.id, id)).run();
}

/** Tenants a user may manage: their own, plus every tenant for admins. */
export async function tenantsFor(user: User): Promise<Tenant[]> {
  const q = db.select().from(schema.tenants).orderBy(desc(schema.tenants.createdAt));
  if (user.role === 'admin') return q.all();
  return q.where(eq(schema.tenants.ownerUserId, user.id)).all();
}

export async function tenantFor(user: User, id: string): Promise<Tenant | undefined> {
  const t = await db.select().from(schema.tenants).where(eq(schema.tenants.id, id)).get();
  if (!t) return undefined;
  if (user.role === 'admin' || t.ownerUserId === user.id) return t;
  return undefined;
}

export function inputFromTenant(t: Tenant): TenantInput {
  return {
    name: t.name,
    ownerName: t.ownerName,
    ownerDescription: t.ownerDescription,
    extraRules: t.extraRules,
    replySla: t.replySla,
    websiteUrl: t.websiteUrl,
    knowledgeMd: t.knowledgeMd,
    bookingUrl: t.bookingUrl,
    notify: parseJson<NotifyConfig>(t.notifyConfig, {}),
    widget: parseJson<WidgetConfig>(t.widgetConfig, {}),
    allowedOrigins: parseJson<string[]>(t.allowedOrigins, []),
  };
}

/** Embed snippet shown in the dashboard. */
export function embedCode(t: Tenant, appOrigin: string): string {
  const w = parseJson<WidgetConfig>(t.widgetConfig, {});
  const attrs = [
    `src="${appOrigin}/widget.js"`,
    `data-tenant="${t.id}"`,
    w.title ? `data-title="${w.title.replace(/"/g, '&quot;')}"` : '',
    w.color ? `data-color="${w.color}"` : '',
    w.position === 'left' ? 'data-position="left"' : '',
    w.greeting ? `data-greeting="${w.greeting.replace(/"/g, '&quot;')}"` : '',
  ].filter(Boolean);
  return `<script ${attrs.join(' ')}></script>`;
}

export interface TenantStats {
  conversations: number;
  userMessages: number;
  userMessagesThisMonth: number;
  leads: number;
  newLeads: number;
}

export async function tenantStats(id: string): Promise<TenantStats> {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const [conv, msgs, msgsMonth, leadsAll, leadsNew] = await Promise.all([
    db.select({ n: count() }).from(schema.conversations).where(eq(schema.conversations.tenantId, id)).get(),
    db.select({ n: count() }).from(schema.messages).where(and(eq(schema.messages.tenantId, id), eq(schema.messages.role, 'user'))).get(),
    db
      .select({ n: count() })
      .from(schema.messages)
      .where(and(eq(schema.messages.tenantId, id), eq(schema.messages.role, 'user'), gte(schema.messages.createdAt, monthStart)))
      .get(),
    db.select({ n: count() }).from(schema.leads).where(eq(schema.leads.tenantId, id)).get(),
    db.select({ n: count() }).from(schema.leads).where(and(eq(schema.leads.tenantId, id), eq(schema.leads.status, 'new'))).get(),
  ]);
  return {
    conversations: conv?.n ?? 0,
    userMessages: msgs?.n ?? 0,
    userMessagesThisMonth: msgsMonth?.n ?? 0,
    leads: leadsAll?.n ?? 0,
    newLeads: leadsNew?.n ?? 0,
  };
}

/** Legacy tenants (seeded from files) have no owner; let the first admin adopt them. */
export async function adoptOrphanTenants(admin: User): Promise<void> {
  if (admin.role !== 'admin') return;
  await db.update(schema.tenants).set({ ownerUserId: admin.id }).where(or(isNull(schema.tenants.ownerUserId), eq(schema.tenants.ownerUserId, ''))).run();
}
