// The Hono app, shared by the local Node server (src/dev.ts) and the Vercel function (api/[[...path]].ts).
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { config } from './config.js';
import { db, schema } from './db/index.js';
import { chatTurn, getOrCreateConversation, getTenant } from './services/chat.js';
import { checkMessage, checkOrigin, checkRateLimits } from './services/guard.js';
import { web, hostedPage } from './web/routes.js';

export const app = new Hono();

// The widget may be embedded on any tenant's site; per-tenant origin checks happen in the handler.
app.use('/api/*', cors({ origin: (origin) => origin }));

app.get('/health', (c) => c.json({ ok: true }));
app.get('/api/health', (c) => c.json({ ok: true }));

/**
 * POST /api/chat
 * body: { message: string, conversationId?: string, visitorId?: string, tenantId?: string }
 * Responds with SSE events: conversation | token | tool | reset | done | error
 * Errors before streaming starts are JSON: { error } with 4xx/5xx.
 */
app.post('/api/chat', async (c) => {
  let body: { message?: string; conversationId?: string; visitorId?: string; tenantId?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400);
  }
  const message = body.message?.trim();
  if (!message) return c.json({ error: 'message is required' }, 400);
  const size = checkMessage(message);
  if (!size.ok) return c.json({ error: size.error }, size.status as 413);

  const tenantId = (body.tenantId ?? 'default').slice(0, 64);
  let tenant;
  try {
    tenant = await getTenant(tenantId);
  } catch {
    return c.json({ error: 'unknown tenant' }, 404);
  }

  const origin = checkOrigin(c.req.header('origin'), tenant);
  if (!origin.ok) return c.json({ error: origin.error }, origin.status as 403);

  const ip = (c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? 'unknown').split(',')[0].trim();
  const visitorId = (body.visitorId ?? '').slice(0, 64) || randomUUID();
  const conversation = await getOrCreateConversation(tenantId, body.conversationId, visitorId, ip);

  const limit = await checkRateLimits({ tenant, visitorId, ip, conversationId: conversation.id });
  if (!limit.ok) return c.json({ error: limit.error }, limit.status as 429);

  return streamSSE(c, async (stream) => {
    await stream.writeSSE({ event: 'conversation', data: conversation.id });
    for await (const ev of chatTurn(tenantId, conversation.id, message)) {
      await stream.writeSSE({ event: ev.type, data: ev.data });
    }
  });
});

// Hosted chat page for tenants without a website: /a/<tenant id>
const hosted = async (c: any) => {
  const t = await db.select().from(schema.tenants).where(eq(schema.tenants.id, c.req.param('id'))).get();
  if (!t) return c.text('not found', 404);
  return c.html(hostedPage(t));
};
app.get('/a/:id', hosted);

// Dashboard. On Vercel, vercel.json rewrites /app/* and /a/* to /api/app/* and /api/a/*
// (only /api/* reaches this function), and Hono sees the rewritten path, so mount both.
app.route('/app', web);
app.route('/api/app', web);
app.get('/api/a/:id', hosted);

export default app;
