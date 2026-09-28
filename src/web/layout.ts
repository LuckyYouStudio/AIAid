// Server-rendered dashboard shell. Plain template strings via hono/html: no build step,
// automatic escaping for interpolated values.
import { html, raw } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';
import type { User } from '../db/schema.js';

export type Html = HtmlEscapedString | Promise<HtmlEscapedString>;

const CSS = `
:root { --ink:#16181d; --muted:#5f6673; --accent:#1f6feb; --soft:#e8f0fe; --bg:#f6f7f9; --card:#fff; --line:#e6e8eb; --bad:#b3261e; --ok:#137333; }
* { box-sizing:border-box }
body { margin:0; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif; color:var(--ink); background:var(--bg); line-height:1.55; font-size:15px }
a { color:var(--accent) }
header.top { background:#fff; border-bottom:1px solid var(--line) }
header.top .wrap { display:flex; align-items:center; justify-content:space-between; height:56px }
.brand { font-weight:700; text-decoration:none; color:var(--ink) }
.wrap { max-width:1040px; margin:0 auto; padding:0 16px }
nav.sub { display:flex; gap:4px; flex-wrap:wrap; margin:16px 0 }
nav.sub a { padding:6px 12px; border-radius:8px; text-decoration:none; color:var(--muted); font-size:14px }
nav.sub a.on { background:var(--soft); color:var(--accent); font-weight:600 }
main { padding:20px 0 60px }
h1 { font-size:24px; margin:0 0 6px } h2 { font-size:18px; margin:24px 0 10px }
.sub { color:var(--muted); margin:0 0 16px }
.card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:18px; margin-bottom:16px }
.grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:12px }
.stat b { display:block; font-size:26px } .stat span { color:var(--muted); font-size:13px }
label { display:block; font-weight:600; font-size:14px; margin:12px 0 4px }
label small { font-weight:400; color:var(--muted) }
input[type=text],input[type=email],input[type=password],input[type=url],input[type=color],select,textarea { width:100%; padding:9px 11px; border:1px solid #cfd4da; border-radius:8px; font:inherit; background:#fff }
textarea { min-height:140px; font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:13px; line-height:1.5 }
textarea.tall { min-height:460px }
.btn { display:inline-block; background:var(--accent); color:#fff; border:0; border-radius:8px; padding:9px 16px; font:inherit; font-weight:600; cursor:pointer; text-decoration:none }
.btn.ghost { background:var(--soft); color:var(--accent) } .btn.danger { background:#fdecea; color:var(--bad) } .btn.sm { padding:5px 10px; font-size:13px }
.row { display:flex; gap:10px; align-items:center; flex-wrap:wrap }
.msg { padding:10px 14px; border-radius:8px; margin:0 0 14px } .msg.err { background:#fdecea; color:var(--bad) } .msg.ok { background:#e6f4ea; color:var(--ok) }
table { width:100%; border-collapse:collapse; background:#fff; border:1px solid var(--line); border-radius:12px; overflow:hidden }
th,td { text-align:left; padding:10px 12px; border-bottom:1px solid var(--line); vertical-align:top; font-size:14px } th { background:#fafbfc; color:var(--muted); font-weight:600 }
tr:last-child td { border-bottom:0 }
code, pre { font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:13px }
pre { background:#0f172a; color:#e2e8f0; padding:14px; border-radius:10px; overflow:auto; white-space:pre-wrap; word-break:break-all }
.pill { display:inline-block; padding:2px 8px; border-radius:999px; font-size:12px; background:var(--soft); color:var(--accent) }
.pill.new { background:#fff4e5; color:#8a4b00 } .pill.won { background:#e6f4ea; color:var(--ok) } .pill.lost { background:#f1f3f4; color:#5f6673 }
.chat { display:flex; flex-direction:column; gap:8px }
.bubble { max-width:80%; padding:10px 13px; border-radius:12px; white-space:pre-wrap; word-break:break-word; font-size:14px }
.bubble.user { align-self:flex-end; background:var(--accent); color:#fff } .bubble.assistant { align-self:flex-start; background:#fff; border:1px solid var(--line) }
.bubble.tool { align-self:center; background:#f1f3f4; color:var(--muted); font-size:12px; font-family:ui-monospace,Menlo,Consolas,monospace }
.auth { max-width:420px; margin:60px auto }
.muted { color:var(--muted) } .small { font-size:13px }
.two { display:grid; grid-template-columns:1fr 1fr; gap:14px } @media (max-width:720px) { .two { grid-template-columns:1fr } }
`;

export function layout(opts: { title: string; user?: User | null; body: Html; tenantNav?: { id: string; name: string; active: string } }): Html {
  const nav = opts.tenantNav
    ? html`<nav class="sub">
        ${[
          ['overview', '概览'],
          ['knowledge', '知识文档'],
          ['settings', '设置'],
          ['leads', '线索'],
          ['conversations', '对话'],
        ].map(([k, label]) => html`<a class="${k === opts.tenantNav!.active ? 'on' : ''}" href="/app/t/${opts.tenantNav!.id}${k === 'overview' ? '' : '/' + k}">${label}</a>`)}
      </nav>`
    : '';
  return html`<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>${opts.title} · LuckyYou 控制台</title>
<style>${raw(CSS)}</style>
</head>
<body>
<header class="top"><div class="wrap">
  <a class="brand" href="/app">LuckyYou 控制台</a>
  <div class="row small">
    ${opts.user
      ? html`<span class="muted">${opts.user.email}${opts.user.role === 'admin' ? html` <span class="pill">admin</span>` : ''}</span>
          <form method="post" action="/app/logout" style="margin:0"><button class="btn ghost sm" type="submit">退出</button></form>`
      : html`<a href="/app/login">登录</a>`}
  </div>
</div></header>
<main><div class="wrap">
  ${opts.tenantNav ? html`<div class="row" style="justify-content:space-between"><h1 style="margin:16px 0 0">${opts.tenantNav.name}</h1><a class="small" href="/app">← 所有助理</a></div>` : ''}
  ${nav}
  ${opts.body}
</div></main>
</body></html>`;
}

export function flash(kind: 'ok' | 'err', text: string | undefined): Html {
  return text ? html`<div class="msg ${kind}">${text}</div>` : html``;
}

export function fmtDate(d: Date | number | null | undefined): string {
  if (!d) return '-';
  const x = typeof d === 'number' ? new Date(d) : d;
  return x.toLocaleString('zh-CN', { hour12: false, timeZone: 'America/Vancouver' });
}
