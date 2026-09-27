// Local / self-hosted Node server. On Vercel, api/index.ts is the entry instead.
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { config } from './config.js';
import { app } from './app.js';

// Static: site at / and the embeddable widget at /widget.js
app.use('/*', serveStatic({ root: './public' }));

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`AIaid listening on http://localhost:${info.port}`);
});
