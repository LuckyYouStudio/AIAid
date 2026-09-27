import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

const url = process.env.DATABASE_URL ?? 'file:./data/app.db';
const authToken = process.env.DATABASE_AUTH_TOKEN;

export default defineConfig({
  dialect: url.startsWith('file:') ? 'sqlite' : 'turso',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: url.startsWith('file:') ? { url } : { url, authToken },
});
