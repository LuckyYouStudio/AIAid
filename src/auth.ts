// Minimal email + password auth with cookie sessions. No external auth library on purpose:
// it keeps the Vercel Node runtime path simple and every line auditable.
import { randomBytes, scrypt as scryptCb, timingSafeEqual, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { and, eq, gt } from 'drizzle-orm';
import type { Context, Next } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { db, schema } from './db/index.js';
import type { User } from './db/schema.js';
import { config } from './config.js';

const scrypt = promisify(scryptCb);
const SESSION_COOKIE = 'aiaid_session';
const SESSION_DAYS = 30;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const key = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${key.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hex] = stored.split(':');
  if (!salt || !hex) return false;
  const key = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(hex, 'hex');
  return key.length === expected.length && timingSafeEqual(key, expected);
}

export async function createUser(email: string, password: string, name?: string): Promise<User> {
  const normalized = email.trim().toLowerCase();
  const role = config.adminEmails.includes(normalized) ? 'admin' : 'user';
  const user = {
    id: randomUUID(),
    email: normalized,
    passwordHash: await hashPassword(password),
    name: name?.trim() || null,
    role,
    createdAt: new Date(),
  };
  await db.insert(schema.users).values(user).run();
  return user;
}

export async function findUserByEmail(email: string): Promise<User | undefined> {
  return db.select().from(schema.users).where(eq(schema.users.email, email.trim().toLowerCase())).get();
}

export async function startSession(c: Context, userId: string): Promise<void> {
  const id = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.insert(schema.sessions).values({ id, userId, expiresAt, createdAt: new Date() }).run();
  setCookie(c, SESSION_COOKIE, id, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: config.isProduction,
    path: '/',
    maxAge: SESSION_DAYS * 86_400,
  });
}

export async function endSession(c: Context): Promise<void> {
  const id = getCookie(c, SESSION_COOKIE);
  if (id) await db.delete(schema.sessions).where(eq(schema.sessions.id, id)).run();
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
}

export async function currentUser(c: Context): Promise<User | null> {
  const id = getCookie(c, SESSION_COOKIE);
  if (!id) return null;
  const row = await db
    .select({ user: schema.users })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.sessions.userId, schema.users.id))
    .where(and(eq(schema.sessions.id, id), gt(schema.sessions.expiresAt, new Date())))
    .get();
  return row?.user ?? null;
}

/** Hono middleware: requires a signed-in user, stores it on the context. Redirects to login otherwise. */
export async function requireUser(c: Context, next: Next) {
  const user = await currentUser(c);
  // Strip the /api prefix Vercel's rewrite adds so the post-login redirect uses the public URL.
  const returnTo = c.req.path.replace(/^\/api(?=\/)/, '');
  if (!user) return c.redirect(`/app/login?next=${encodeURIComponent(returnTo)}`);
  c.set('user', user);
  await next();
}

/** CSRF guard for form posts: the Origin (or Referer) must be our own app. */
export function sameOrigin(c: Context): boolean {
  const origin = c.req.header('origin') ?? (c.req.header('referer') ? new URL(c.req.header('referer')!).origin : '');
  const self = new URL(c.req.url).origin;
  return origin === self || config.appOrigins.includes(origin);
}
