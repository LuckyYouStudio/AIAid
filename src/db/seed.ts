import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { db, schema } from './index.js';
import { config } from '../config.js';
import { buildSystemPrompt } from '../llm/prompt.js';

export const DEFAULT_TENANT_ID = 'default';

const knowledgeMd = readFileSync(new URL('../../knowledge/knowledge.md', import.meta.url), 'utf8');

const notifyConfig = {
  channel: config.notifyChannel,
  replySla: config.replySla,
  telegram: config.telegramBotToken
    ? { botToken: config.telegramBotToken, chatId: config.telegramChatId }
    : undefined,
};

const row = {
  id: DEFAULT_TENANT_ID,
  name: config.ownerName,
  systemPrompt: buildSystemPrompt({ ownerName: config.ownerName, replySla: config.replySla }),
  knowledgeMd,
  bookingUrl: config.bookingUrl,
  notifyConfig: JSON.stringify(notifyConfig),
  createdAt: new Date(),
};

const existing = await db.select().from(schema.tenants).where(eq(schema.tenants.id, DEFAULT_TENANT_ID)).get();
if (existing) {
  await db.update(schema.tenants).set({ ...row, createdAt: existing.createdAt }).where(eq(schema.tenants.id, DEFAULT_TENANT_ID)).run();
  console.log(`Updated tenant "${DEFAULT_TENANT_ID}" from knowledge/knowledge.md and .env (${config.databaseUrl.split('@').pop()})`);
} else {
  await db.insert(schema.tenants).values(row).run();
  console.log(`Created tenant "${DEFAULT_TENANT_ID}" (${config.databaseUrl})`);
}
