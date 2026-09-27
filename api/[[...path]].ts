// Vercel serverless entry. The optional catch-all filename makes this function handle /api and
// every path under /api/* without rewrites; static files in /public are served by Vercel directly.
//
// Exporting per-method handlers (instead of a default export) makes Vercel use the Web API
// signature: we receive a standard Request and return a standard Response, so streaming works
// and the body is not pre-consumed by Node's bodyParser.
import { handle } from 'hono/vercel';
import { app } from '../src/app.js';

const handler = handle(app);

export const GET = handler;
export const POST = handler;
export const OPTIONS = handler;
