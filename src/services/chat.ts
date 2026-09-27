import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { config } from '../config.js';
import { db, schema } from '../db/index.js';
import type { Lead, Tenant } from '../db/schema.js';
import { composeSystemMessage } from '../llm/prompt.js';
import { streamCompletion, type ChatMessage } from '../llm/openai.js';
import { toolDefinitions, type NotifyOwnerArgs, type SaveLeadArgs } from '../llm/tools.js';
import { notifierFor, type NotifyConfig } from '../notify/index.js';

const MAX_TOOL_ROUNDS = 4;

export interface ChatEvent {
  type: 'token' | 'tool' | 'done' | 'error';
  data: string;
}

export async function getTenant(tenantId: string): Promise<Tenant> {
  const t = await db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)).get();
  if (!t) throw new Error(`Unknown tenant: ${tenantId}`);
  return t;
}

export async function getOrCreateConversation(
  tenantId: string,
  conversationId: string | undefined,
  visitorId: string,
  ip: string | null = null,
) {
  if (conversationId) {
    const c = await db.select().from(schema.conversations).where(eq(schema.conversations.id, conversationId)).get();
    if (c && c.tenantId === tenantId) return c;
  }
  const c = { id: randomUUID(), tenantId, visitorId, ip, startedAt: new Date(), language: null };
  await db.insert(schema.conversations).values(c).run();
  return c;
}

async function saveMessage(tenantId: string, conversationId: string, role: string, content: string, meta?: unknown) {
  await db
    .insert(schema.messages)
    .values({
      id: randomUUID(),
      tenantId,
      conversationId,
      role,
      content,
      meta: meta === undefined ? null : JSON.stringify(meta),
      createdAt: new Date(),
    })
    .run();
}

/** Rebuild the OpenAI message list from persisted messages, keeping only a recent window. */
async function loadHistory(conversationId: string): Promise<ChatMessage[]> {
  const all = await db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.conversationId, conversationId))
    .orderBy(asc(schema.messages.createdAt))
    .all();

  // Trim to the last N messages, then drop any leading tool results / assistant tool-call
  // messages so the window never starts mid tool exchange (the API rejects that).
  let rows = all.slice(-config.limits.historyMessages);
  while (rows.length && rows[0].role !== 'user') rows = rows.slice(1);

  return rows.map((m): ChatMessage => {
    if (m.role === 'assistant') {
      const toolCalls = m.meta ? JSON.parse(m.meta) : undefined;
      return { role: 'assistant', content: m.content || null, tool_calls: toolCalls };
    }
    if (m.role === 'tool') {
      return { role: 'tool', content: m.content, tool_call_id: m.meta ? JSON.parse(m.meta) : '' };
    }
    return { role: 'user', content: m.content };
  });
}

/** Saves the lead; `contactCaptured` is true the first time a contact method lands on it. */
async function upsertLead(
  tenantId: string,
  conversationId: string,
  args: SaveLeadArgs,
): Promise<{ lead: Lead; contactCaptured: boolean }> {
  const existing = await db.select().from(schema.leads).where(eq(schema.leads.conversationId, conversationId)).get();
  const patch = Object.fromEntries(Object.entries(args).filter(([, v]) => typeof v === 'string' && v.trim()));
  if (existing) {
    await db.update(schema.leads).set(patch).where(eq(schema.leads.id, existing.id)).run();
    const lead = { ...existing, ...patch };
    return { lead, contactCaptured: !existing.contact && !!lead.contact };
  }
  const lead: Lead = {
    id: randomUUID(),
    tenantId,
    conversationId,
    name: null,
    company: null,
    need: null,
    budget: null,
    timeline: null,
    contact: null,
    status: 'new',
    createdAt: new Date(),
    ...patch,
  };
  await db.insert(schema.leads).values(lead).run();
  return { lead, contactCaptured: !!lead.contact };
}

async function runTool(tenant: Tenant, conversationId: string, name: string, rawArgs: string): Promise<string> {
  let args: unknown;
  try {
    args = rawArgs ? JSON.parse(rawArgs) : {};
  } catch {
    return JSON.stringify({ ok: false, error: 'invalid JSON arguments' });
  }

  if (name === 'save_lead') {
    const { lead, contactCaptured } = await upsertLead(tenant.id, conversationId, args as SaveLeadArgs);
    // The owner is notified the moment a lead becomes reachable, regardless of whether the
    // model also decides to call notify_owner. This must not depend on the model remembering.
    let ownerNotified = false;
    if (contactCaptured) {
      const cfg = JSON.parse(tenant.notifyConfig || '{}') as NotifyConfig;
      try {
        await notifierFor(cfg).send({
          reason: 'new_lead',
          summary: `New lead with contact details: ${lead.need ?? '(need not stated yet)'}`,
          conversationId,
          lead,
        });
        ownerNotified = true;
      } catch (err) {
        console.error('new_lead notification failed:', err);
      }
    }
    return JSON.stringify({ ok: true, lead_id: lead.id, owner_notified: ownerNotified });
  }

  if (name === 'notify_owner') {
    const a = args as NotifyOwnerArgs;
    const cfg = JSON.parse(tenant.notifyConfig || '{}') as NotifyConfig;
    const lead = await db.select().from(schema.leads).where(eq(schema.leads.conversationId, conversationId)).get();
    // Only interrupt the owner when they can act on it: the visitor is reachable, or they
    // explicitly want a quote. Anything else waits until a contact method arrives (which then
    // triggers the automatic new_lead notification in save_lead).
    if (!lead?.contact && a.reason !== 'quote_request') {
      return JSON.stringify({
        ok: false,
        skipped: true,
        error: 'owner not notified: no contact method yet. Ask the visitor for an email/phone/WeChat so the owner can reply.',
      });
    }
    try {
      await notifierFor(cfg).send({ reason: a.reason, summary: a.summary, conversationId, lead });
      return JSON.stringify({ ok: true, reply_sla: cfg.replySla ?? 'soon' });
    } catch (err) {
      console.error('notify_owner failed:', err);
      return JSON.stringify({ ok: false, error: 'notification failed; tell the visitor the owner will still follow up' });
    }
  }

  return JSON.stringify({ ok: false, error: `unknown tool ${name}` });
}

/**
 * Handles one user turn: persists it, runs the LLM loop (with tool calls), persists the
 * assistant output, and yields streaming events.
 */
export async function* chatTurn(
  tenantId: string,
  conversationId: string,
  userText: string,
): AsyncGenerator<ChatEvent> {
  const tenant = await getTenant(tenantId);
  await saveMessage(tenantId, conversationId, 'user', userText);

  const messages: ChatMessage[] = [
    { role: 'system', content: composeSystemMessage(tenant) },
    ...(await loadHistory(conversationId)),
  ];

  const queue: ChatEvent[] = [];
  let finished = false;
  let failure: unknown;

  const run = (async () => {
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const result = await streamCompletion(messages, toolDefinitions, (t) => queue.push({ type: 'token', data: t }));

      const toolCalls = result.toolCalls.filter((tc) => tc.id && tc.name);
      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: result.content || null,
        ...(toolCalls.length
          ? {
              tool_calls: toolCalls.map((tc) => ({
                id: tc.id,
                type: 'function' as const,
                function: { name: tc.name, arguments: tc.arguments },
              })),
            }
          : {}),
      };
      messages.push(assistantMsg);
      await saveMessage(tenantId, conversationId, 'assistant', result.content, toolCalls.length ? (assistantMsg as any).tool_calls : undefined);

      if (!toolCalls.length) return;

      for (const tc of toolCalls) {
        queue.push({ type: 'tool', data: tc.name });
        const output = await runTool(tenant, conversationId, tc.name, tc.arguments);
        messages.push({ role: 'tool', tool_call_id: tc.id, content: output });
        await saveMessage(tenantId, conversationId, 'tool', output, tc.id);
      }
    }
  })()
    .catch((err) => (failure = err))
    .finally(() => (finished = true));

  while (!finished || queue.length) {
    if (queue.length) {
      yield queue.shift()!;
    } else {
      await new Promise((r) => setTimeout(r, 15));
    }
  }
  await run;
  if (failure) yield { type: 'error', data: failure instanceof Error ? failure.message : String(failure) };
  else yield { type: 'done', data: conversationId };
}
