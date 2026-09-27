// Vercel serverless entry. Static files in /public are served by Vercel directly;
// vercel.json rewrites /api/* and /health to this function.
import { handle } from 'hono/vercel';
import { app } from '../src/app.js';

export default handle(app);
