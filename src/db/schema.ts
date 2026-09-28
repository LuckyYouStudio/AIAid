import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

// Every business table carries tenant_id so this can grow into multi-tenant SaaS.

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name'),
  // 'user' | 'admin' (admin sees every tenant)
  role: text('role').notNull().default('user'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const tenants = sqliteTable('tenants', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  // Null for legacy/seeded tenants; admins can see and edit those.
  ownerUserId: text('owner_user_id'),
  // Inputs the system prompt is built from (system_prompt is the rendered result).
  ownerName: text('owner_name').notNull().default(''),
  ownerDescription: text('owner_description').notNull().default(''),
  extraRules: text('extra_rules').notNull().default(''),
  replySla: text('reply_sla').notNull().default('within 24 hours'),
  websiteUrl: text('website_url').notNull().default(''),
  systemPrompt: text('system_prompt').notNull(),
  knowledgeMd: text('knowledge_md').notNull(),
  bookingUrl: text('booking_url').notNull().default(''),
  // JSON: { channel: 'console' | 'telegram' | 'email', email?, telegram?: { botToken, chatId }, replySla }
  notifyConfig: text('notify_config').notNull().default('{}'),
  // JSON: { title, color, greeting, position }
  widgetConfig: text('widget_config').notNull().default('{}'),
  // JSON array of origins allowed to embed this tenant's widget, e.g. ["https://example.com"]
  allowedOrigins: text('allowed_origins').notNull().default('[]'),
  // User messages per calendar month; 0 = unlimited.
  monthlyLimit: integer('monthly_limit').notNull().default(300),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const conversations = sqliteTable('conversations', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  visitorId: text('visitor_id').notNull(),
  // Client IP (from x-forwarded-for) used for rate limiting alongside visitor_id.
  ip: text('ip'),
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

export type User = typeof users.$inferSelect;
export type Tenant = typeof tenants.$inferSelect;
export type Lead = typeof leads.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
