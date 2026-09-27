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
  databaseUrl: process.env.DATABASE_URL ?? 'file:./data/app.db',
  databaseAuthToken: process.env.DATABASE_AUTH_TOKEN,
  ownerName: process.env.OWNER_NAME ?? 'William',
  bookingUrl: process.env.BOOKING_URL ?? '',
  replySla: process.env.REPLY_SLA ?? 'within 24 hours',
  notifyChannel: (process.env.NOTIFY_CHANNEL ?? 'console') as 'console' | 'telegram',
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
  telegramChatId: process.env.TELEGRAM_CHAT_ID,
};
