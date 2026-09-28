// Vercel serverless entry. Every dynamic route is rewritten here by vercel.json with the
// original path carried in ?__path= (Vercel's filesystem routing for api/ only matched
// single-segment paths, and its rewrites hand the function the rewritten path). We restore
// the original URL and let Hono route it. Static files in /public are served by Vercel.
//
// Per-method exports make Vercel use the Web API signature (Request in, Response out),
// which streams correctly and leaves the request body untouched.
import { app } from '../src/app.js';

// Website import (fetch pages + model) can take a while; allow up to 60s.
export const maxDuration = 60;

const handler = (req: Request) => {
  const url = new URL(req.url);
  const original = url.searchParams.get('__path');
  if (original) {
    url.searchParams.delete('__path');
    url.pathname = original;
  }
  return app.fetch(new Request(url.toString(), req));
};

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
