import 'dotenv/config';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const config = {
  openaiApiKey: required('OPENAI_API_KEY'),
  openaiModel: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
  openaiBaseUrl: process.env.OPENAI_BASE_URL,
  port: Number(process.env.PORT ?? 3000),
  databasePath: process.env.DATABASE_PATH ?? './data/app.db',
  ownerName: process.env.OWNER_NAME ?? 'William',
  bookingUrl: process.env.BOOKING_URL ?? '',
  replySla: process.env.REPLY_SLA ?? 'within 24 hours',
  notifyChannel: (process.env.NOTIFY_CHANNEL ?? 'console') as 'console' | 'telegram',
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
  telegramChatId: process.env.TELEGRAM_CHAT_ID,
};
