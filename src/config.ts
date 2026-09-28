import 'dotenv/config';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const config = {
  openaiApiKey: required('OPENAI_API_KEY'),
  openaiModel: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
  // Used for the single retry after a transient provider error (empty = same model).
  openaiFallbackModel: process.env.OPENAI_FALLBACK_MODEL ?? '',
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

  isProduction: process.env.VERCEL === '1' || process.env.NODE_ENV === 'production',
  // Where the dashboard lives (used for links in emails and CSRF checks).
  appOrigins: (process.env.APP_ORIGINS ?? 'https://www.the5288.com,http://localhost:3000').split(',').map((s) => s.trim()),
  // Emails that get the admin role on signup (see every tenant).
  adminEmails: (process.env.ADMIN_EMAILS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  // Transactional email (Resend). Without a key, email notifications are logged instead of sent.
  resendApiKey: process.env.RESEND_API_KEY,
  emailFrom: process.env.EMAIL_FROM ?? 'LuckyYou Studio <onboarding@resend.dev>',

  // Abuse protection. Origins are the sites allowed to embed the widget / call /api/chat.
  allowedOrigins: (
    process.env.ALLOWED_ORIGINS ??
    'https://www.the5288.com,https://the5288.com,https://aiaid-sepia.vercel.app,http://localhost:3000'
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  limits: {
    perMinute: num('LIMIT_PER_MINUTE', 100), // user messages per visitor or IP
    perDay: num('LIMIT_PER_DAY', 1000),
    globalPerDay: num('LIMIT_GLOBAL_PER_DAY', 20000), // all visitors combined; hard cost stop
    maxMessageChars: num('LIMIT_MESSAGE_CHARS', 1000),
    maxTurnsPerConversation: num('LIMIT_TURNS_PER_CONVERSATION', 40),
    historyMessages: num('LIMIT_HISTORY_MESSAGES', 24), // messages sent to the model
    maxOutputTokens: num('LIMIT_OUTPUT_TOKENS', 600),
    monthlyPerTenant: num('LIMIT_MONTHLY_PER_TENANT', 300), // free tier: user messages per assistant per month
  },
};

function num(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}
