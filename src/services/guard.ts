// Abuse protection that must not depend on the model: origin allowlist, size caps and
// DB-backed rate limits (the server is serverless, so in-memory counters would not work).
import { and, count, eq, gt, or } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { config } from '../config.js';

export type GuardResult = { ok: true } | { ok: false; status: number; error: string };

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export function checkOrigin(origin: string | undefined): GuardResult {
  if (!origin) return { ok: false, status: 403, error: 'origin required' };
  if (!config.allowedOrigins.includes(origin)) return { ok: false, status: 403, error: 'origin not allowed' };
  return { ok: true };
}

export function checkMessage(message: string): GuardResult {
  if (message.length > config.limits.maxMessageChars) {
    return { ok: false, status: 413, error: `message too long (max ${config.limits.maxMessageChars} characters)` };
  }
  return { ok: true };
}

async function userMessagesSince(since: Date, where?: ReturnType<typeof or>): Promise<number> {
  const base = and(eq(schema.messages.role, 'user'), gt(schema.messages.createdAt, since));
  const row = await db
    .select({ n: count() })
    .from(schema.messages)
    .innerJoin(schema.conversations, eq(schema.messages.conversationId, schema.conversations.id))
    .where(where ? and(base, where) : base)
    .get();
  return row?.n ?? 0;
}

export async function checkRateLimits(args: {
  visitorId: string;
  ip: string;
  conversationId: string;
}): Promise<GuardResult> {
  const now = Date.now();
  const who = or(eq(schema.conversations.visitorId, args.visitorId), eq(schema.conversations.ip, args.ip));
  const { limits } = config;

  const [lastMinute, lastDay, globalDay, turns] = await Promise.all([
    userMessagesSince(new Date(now - MINUTE), who),
    userMessagesSince(new Date(now - DAY), who),
    userMessagesSince(new Date(now - DAY)),
    db
      .select({ n: count() })
      .from(schema.messages)
      .where(and(eq(schema.messages.conversationId, args.conversationId), eq(schema.messages.role, 'user')))
      .get()
      .then((r) => r?.n ?? 0),
  ]);

  if (lastMinute >= limits.perMinute) return { ok: false, status: 429, error: 'too many messages, please wait a minute' };
  if (lastDay >= limits.perDay) return { ok: false, status: 429, error: 'daily message limit reached, please email us instead' };
  if (turns >= limits.maxTurnsPerConversation) return { ok: false, status: 429, error: 'this conversation is full, please start a new one' };
  if (globalDay >= limits.globalPerDay) return { ok: false, status: 503, error: 'the assistant is busy today, please email us instead' };
  return { ok: true };
}
