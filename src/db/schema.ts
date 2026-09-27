import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

// Every business table carries tenant_id so this can grow into multi-tenant SaaS.

export const tenants = sqliteTable('tenants', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  systemPrompt: text('system_prompt').notNull(),
  knowledgeMd: text('knowledge_md').notNull(),
  bookingUrl: text('booking_url').notNull().default(''),
  // JSON: { channel: 'console' | 'telegram', telegram?: { botToken, chatId }, replySla: string }
  notifyConfig: text('notify_config').notNull().default('{}'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const conversations = sqliteTable('conversations', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  visitorId: text('visitor_id').notNull(),
  startedAt: integer('started_at', { mode: 'timestamp_ms' }).notNull(),
  language: text('language'),
});

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  conversationId: text('conversation_id').notNull().references(() => conversations.id),
  // 'user' | 'assistant' | 'tool'
  role: text('role').notNull(),
  content: text('content').notNull(),
  // JSON string of OpenAI tool_calls on assistant messages, or tool_call_id on tool messages
  meta: text('meta'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const leads = sqliteTable('leads', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  conversationId: text('conversation_id').notNull().references(() => conversations.id),
  name: text('name'),
  company: text('company'),
  need: text('need'),
  budget: text('budget'),
  timeline: text('timeline'),
  contact: text('contact'),
  // 'new' | 'contacted' | 'won' | 'lost'
  status: text('status').notNull().default('new'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export type Tenant = typeof tenants.$inferSelect;
export type Lead = typeof leads.$inferSelect;
export type Message = typeof messages.$inferSelect;
