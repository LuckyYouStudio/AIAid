// Vercel serverless entry (Node runtime). The optional catch-all filename makes this function
// handle /api and every path under /api/* without rewrites. Static files in /public are
// served by Vercel directly. @hono/node-server/vercel bridges Node's (req, res) to app.fetch
// and supports streaming; bodyParser is disabled so Hono reads the raw body itself.
import { handle } from '@hono/node-server/vercel';
import { app } from '../src/app.js';

export const config = { api: { bodyParser: false } };

export default handle(app);
