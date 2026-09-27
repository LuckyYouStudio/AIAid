// Vercel serverless entry. The optional catch-all filename makes this function handle
// /api and every path under /api/* without rewrites, so Hono sees the original URL.
// Static files in /public are served by Vercel directly.
import { handle } from 'hono/vercel';
import { app } from '../src/app.js';

export default handle(app);
