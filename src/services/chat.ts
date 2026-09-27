import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
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

export function getTenant(tenantId: string): Tenant {
  const t = db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)).get();
  if (!t) throw new Error(`Unknown tenant: ${tenantId}`);
  return t;
}

export function getOrCreateConversation(tenantId: string, conversationId: string | undefined, visitorId: string) {
  if (conversationId) {
    const c = db.select().from(schema.conversations).where(eq(schema.conversations.id, conversationId)).get();
    if (c && c.tenantId === tenantId) return c;
  }
  const c = { id: randomUUID(), tenantId, visitorId, startedAt: new Date(), language: null };
  db.insert(schema.conversations).values(c).run();
  return c;
}

function saveMessage(tenantId: string, conversationId: string, role: string, content: string, meta?: unknown) {
  db.insert(schema.messages)
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

/** Rebuild the OpenAI message list from persisted messages. */
function loadHistory(conversationId: string): ChatMessage[] {
  const rows = db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.conversationId, conversationId))
    .orderBy(asc(schema.messages.createdAt))
    .all();

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

function upsertLead(tenantId: string, conversationId: string, args: SaveLeadArgs): Lead {
  const existing = db.select().from(schema.leads).where(eq(schema.leads.conversationId, conversationId)).get();
  const patch = Object.fromEntries(Object.entries(args).filter(([, v]) => typeof v === 'string' && v.trim()));
  if (existing) {
    db.update(schema.leads).set(patch).where(eq(schema.leads.id, existing.id)).run();
    return { ...existing, ...patch };
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
  db.insert(schema.leads).values(lead).run();
  return lead;
}

async function runTool(tenant: Tenant, conversationId: string, name: string, rawArgs: string): Promise<string> {
  let args: unknown;
  try {
    args = rawArgs ? JSON.parse(rawArgs) : {};
  } catch {
    return JSON.stringify({ ok: false, error: 'invalid JSON arguments' });
  }

  if (name === 'save_lead') {
    const lead = upsertLead(tenant.id, conversationId, args as SaveLeadArgs);
    return JSON.stringify({ ok: true, lead_id: lead.id });
  }

  if (name === 'notify_owner') {
    const a = args as NotifyOwnerArgs;
    const cfg = JSON.parse(tenant.notifyConfig || '{}') as NotifyConfig;
    const lead = db.select().from(schema.leads).where(eq(schema.leads.conversationId, conversationId)).get();
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
  const tenant = getTenant(tenantId);
  saveMessage(tenantId, conversationId, 'user', userText);

  const messages: ChatMessage[] = [
    { role: 'system', content: composeSystemMessage(tenant) },
    ...loadHistory(conversationId),
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
      saveMessage(tenantId, conversationId, 'assistant', result.content, toolCalls.length ? (assistantMsg as any).tool_calls : undefined);

      if (!toolCalls.length) return;

      for (const tc of toolCalls) {
        queue.push({ type: 'tool', data: tc.name });
        const output = await runTool(tenant, conversationId, tc.name, tc.arguments);
        messages.push({ role: 'tool', tool_call_id: tc.id, content: output });
        saveMessage(tenantId, conversationId, 'tool', output, tc.id);
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
