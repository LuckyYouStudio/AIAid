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

  // Abuse protection. Origins are the sites allowed to embed the widget / call /api/chat.
  allowedOrigins: (
    process.env.ALLOWED_ORIGINS ??
    'https://www.the5288.com,https://the5288.com,https://aiaid-sepia.vercel.app,http://localhost:3000'
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  limits: {
    perMinute: num('LIMIT_PER_MINUTE', 10), // user messages per visitor or IP
    perDay: num('LIMIT_PER_DAY', 60),
    globalPerDay: num('LIMIT_GLOBAL_PER_DAY', 2000), // all visitors combined; hard cost stop
    maxMessageChars: num('LIMIT_MESSAGE_CHARS', 1000),
    maxTurnsPerConversation: num('LIMIT_TURNS_PER_CONVERSATION', 40),
    historyMessages: num('LIMIT_HISTORY_MESSAGES', 24), // messages sent to the model
    maxOutputTokens: num('LIMIT_OUTPUT_TOKENS', 600),
  },
};

function num(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}
