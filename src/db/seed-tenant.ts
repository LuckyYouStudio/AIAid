// Seed or update any tenant from a folder: tenants/<id>/tenant.json + tenants/<id>/knowledge.md
// Usage: npm run db:seed:tenant -- tenants/carriekwai
// Notification credentials come from .env (the owner of this deployment receives all demo
// notifications); tenant.json only says which channel to use.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { db, schema } from './index.js';
import { config } from '../config.js';
import { buildSystemPrompt } from '../llm/prompt.js';

interface TenantFile {
  id: string;
  name: string;
  ownerName: string;
  ownerDescription?: string;
  bookingUrl?: string;
  replySla?: string;
  notifyChannel?: 'console' | 'telegram';
  extraRules?: string[];
  websiteUrl?: string;
  widget?: { title?: string; color?: string; greeting?: string; position?: 'right' | 'left' };
  allowedOrigins?: string[];
  monthlyLimit?: number;
}

const dir = process.argv[2];
if (!dir) {
  console.error('Usage: tsx src/db/seed-tenant.ts <tenant folder>');
  process.exit(1);
}
const folder = resolve(dir);
const t = JSON.parse(readFileSync(join(folder, 'tenant.json'), 'utf8')) as TenantFile;
const knowledgeMd = readFileSync(join(folder, 'knowledge.md'), 'utf8');
const replySla = t.replySla ?? 'within 24 hours';
const channel = t.notifyChannel ?? config.notifyChannel;

const notifyConfig = {
  channel,
  replySla,
  telegram:
    channel === 'telegram' && config.telegramBotToken
      ? { botToken: config.telegramBotToken, chatId: config.telegramChatId }
      : undefined,
};

const row = {
  id: t.id,
  name: t.name,
  ownerName: t.ownerName,
  ownerDescription: t.ownerDescription ?? '',
  extraRules: (t.extraRules ?? []).join('\n'),
  replySla,
  websiteUrl: t.websiteUrl ?? '',
  systemPrompt: buildSystemPrompt({
    ownerName: t.ownerName,
    replySla,
    ownerDescription: t.ownerDescription,
    extraRules: (t.extraRules ?? []).map((r) => `- ${r}`).join('\n'),
  }),
  knowledgeMd,
  bookingUrl: t.bookingUrl ?? '',
  notifyConfig: JSON.stringify(notifyConfig),
  widgetConfig: JSON.stringify(t.widget ?? {}),
  allowedOrigins: JSON.stringify(t.allowedOrigins ?? []),
  monthlyLimit: t.monthlyLimit ?? 0,
  createdAt: new Date(),
};

const existing = await db.select().from(schema.tenants).where(eq(schema.tenants.id, t.id)).get();
if (existing) {
  await db.update(schema.tenants).set({ ...row, createdAt: existing.createdAt }).where(eq(schema.tenants.id, t.id)).run();
  console.log(`Updated tenant "${t.id}" (${config.databaseUrl.split('@').pop()})`);
} else {
  await db.insert(schema.tenants).values(row).run();
  console.log(`Created tenant "${t.id}" (${config.databaseUrl.split('@').pop()})`);
}
