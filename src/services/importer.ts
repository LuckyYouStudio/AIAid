// Builds a first knowledge document from a business website: fetch the home page and a
// handful of internal pages, strip them to text, then ask the model to write the document
// in the structure the assistant expects. Plain fetch only (no headless browser) so it runs
// inside a serverless function.
import { openai } from '../llm/openai.js';
import { config } from '../config.js';

const MAX_PAGES = 6;
const MAX_CHARS_PER_PAGE = 6000;
const FETCH_TIMEOUT_MS = 8000;
const INTERESTING = /about|service|price|pricing|faq|contact|menu|team|book|appointment|listing|rent|buy|sell|product|关于|服务|价格|收费|联系|预约|常见|菜单|团队|介绍|方案/i;

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|p|div|li|h[1-6]|tr|section|article|header|footer)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

function extractLinks(html: string, base: URL): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)) {
    try {
      const u = new URL(m[1], base);
      if (u.origin !== base.origin) continue;
      if (/\.(jpg|jpeg|png|gif|svg|pdf|zip|mp4|css|js)$/i.test(u.pathname)) continue;
      u.hash = '';
      u.search = '';
      out.add(u.toString());
    } catch {
      /* ignore */
    }
  }
  return [...out];
}

async function fetchPage(url: string): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; LuckyYouBot/1.0; +https://www.the5288.com)', accept: 'text/html,*/*' },
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const type = res.headers.get('content-type') ?? '';
    if (!/html|text/i.test(type)) throw new Error(`not html (${type})`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

export interface ImportResult {
  knowledgeMd: string;
  pagesUsed: string[];
  suggestedName: string;
}

export async function importFromWebsite(rawUrl: string): Promise<ImportResult> {
  const base = new URL(rawUrl.includes('://') ? rawUrl : `https://${rawUrl}`);
  const homeHtml = await fetchPage(base.toString());
  const title = (homeHtml.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? '').trim();

  const candidates = extractLinks(homeHtml, base)
    .filter((u) => u !== base.toString() && u !== base.origin + '/')
    .sort((a, b) => Number(INTERESTING.test(b)) - Number(INTERESTING.test(a)))
    .slice(0, MAX_PAGES - 1);

  const pages: { url: string; text: string }[] = [{ url: base.toString(), text: htmlToText(homeHtml).slice(0, MAX_CHARS_PER_PAGE) }];
  const results = await Promise.allSettled(candidates.map(async (u) => ({ url: u, text: htmlToText(await fetchPage(u)).slice(0, MAX_CHARS_PER_PAGE) })));
  for (const r of results) if (r.status === 'fulfilled' && r.value.text.length > 200) pages.push(r.value);

  const corpus = pages.map((p) => `### ${p.url}\n${p.text}`).join('\n\n');

  const completion = await openai.chat.completions.create({
    model: config.openaiModel,
    max_completion_tokens: 2500,
    messages: [
      {
        role: 'system',
        content: `You write the knowledge document that powers an AI reception assistant for a small business. Using ONLY facts present in the provided website text, produce a Markdown document with these sections (keep a heading even if a section has little content, and say what is missing so the owner can fill it in):

# <Business name>
## 关于 / About
## 服务 / Services
## 价格 / Pricing  (ranges only; if none on the site, write "价格请与我们联系 / Contact us for pricing")
## 流程 / How it works
## 常见问题 / FAQ
## 联系 / Contact  (phone, email, address, hours, social links found on the site)
## 不做 / Out of scope  (leave a placeholder line if unknown)

Rules: never invent prices, addresses, credentials or services that are not in the text. Keep concrete numbers exactly as written. Write in the site's main language; if the site is bilingual keep both. Be concise but complete: aim for 400-900 words. Output only the Markdown.`,
      },
      { role: 'user', content: `Website: ${base.origin}\nPage title: ${title}\n\n${corpus.slice(0, 30000)}` },
    ],
  });

  const knowledgeMd = (completion.choices[0]?.message?.content ?? '').trim() || `# ${title || base.hostname}\n\n(导入失败，请手动填写。)`;
  const suggestedName = (knowledgeMd.match(/^#\s+(.+)$/m)?.[1] ?? title ?? base.hostname).replace(/[|｜].*$/, '').trim().slice(0, 60);
  return { knowledgeMd, pagesUsed: pages.map((p) => p.url), suggestedName: suggestedName || base.hostname };
}
