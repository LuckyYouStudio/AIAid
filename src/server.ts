import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { serve } from '@hono/node-server';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { chatTurn, getOrCreateConversation, getTenant } from './services/chat.js';

const app = new Hono();
app.use('/api/*', cors());

app.get('/health', (c) => c.json({ ok: true }));

/**
 * POST /api/chat
 * body: { message: string, conversationId?: string, visitorId?: string, tenantId?: string }
 * Responds with SSE events: token | tool | done | error
 */
app.post('/api/chat', async (c) => {
  const body = await c.req.json<{ message?: string; conversationId?: string; visitorId?: string; tenantId?: string }>();
  const message = body.message?.trim();
  if (!message) return c.json({ error: 'message is required' }, 400);

  const tenantId = body.tenantId ?? 'default';
  try {
    getTenant(tenantId);
  } catch {
    return c.json({ error: 'unknown tenant' }, 404);
  }

  const conversation = getOrCreateConversation(tenantId, body.conversationId, body.visitorId ?? randomUUID());

  return streamSSE(c, async (stream) => {
    await stream.writeSSE({ event: 'conversation', data: conversation.id });
    for await (const ev of chatTurn(tenantId, conversation.id, message)) {
      await stream.writeSSE({ event: ev.type, data: ev.data });
    }
  });
});

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`AIaid listening on http://localhost:${info.port}`);
});
