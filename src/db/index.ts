import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from '../config.js';
import * as schema from './schema.js';

// Local dev: DATABASE_URL=file:./data/app.db
// Production (Vercel + Turso): DATABASE_URL=libsql://xxx.turso.io + DATABASE_AUTH_TOKEN
if (config.databaseUrl.startsWith('file:')) {
  mkdirSync(dirname(config.databaseUrl.slice('file:'.length)), { recursive: true });
}

const client = createClient({ url: config.databaseUrl, authToken: config.databaseAuthToken });

export const db = drizzle(client, { schema });
export { schema };
