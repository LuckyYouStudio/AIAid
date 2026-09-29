// Dashboard: signup/login, list assistants, create (optionally importing from a website),
// edit knowledge, settings, leads and conversations. Admins see every tenant.
import { Hono } from 'hono';
import { html, raw } from 'hono/html';
import { and, asc, desc, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import type { User } from '../db/schema.js';
import { createUser, currentUser, endSession, findUserByEmail, requireUser, sameOrigin, startSession, verifyPassword } from '../auth.js';
import { layout, flash, fmtDate } from './layout.js';
import {
  adoptOrphanTenants,
  createTenant,
  deleteTenant,
  embedCode,
  inputFromTenant,
  parseJson,
  tenantFor,
  tenantStats,
  tenantsFor,
  updateTenant,
  type TenantInput,
} from '../services/tenants.js';
import { importFromWebsite } from '../services/importer.js';
import { config } from '../config.js';

type Env = { Variables: { user: User } };
export const web = new Hono<Env>();

const field = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const appOrigin = (c: { req: { url: string } }) => new URL(c.req.url).origin;

/* ---------------- auth ---------------- */

const authPage = (kind: 'login' | 'signup', err?: string, next = '') => {
  const isLogin = kind === 'login';
  return layout({
    title: isLogin ? '登录' : '注册',
    body: html`<div class="auth card">
      <h1>${isLogin ? '登录' : '创建账号'}</h1>
      <p class="sub">${isLogin ? '管理你的 AI 接待助理。' : '几分钟内给你的网站配一个 AI 前台。免费额度每月 300 条消息。'}</p>
      ${flash('err', err)}
      <form method="post" action="/app/${kind}">
        <input type="hidden" name="next" value="${next}" />
        ${isLogin ? '' : html`<label>你的名字 <small>（可选）</small></label><input type="text" name="name" maxlength="60" />`}
        <label>邮箱</label><input type="email" name="email" required autocomplete="email" />
        <label>密码 <small>${isLogin ? '' : '至少 8 位'}</small></label><input type="password" name="password" required minlength="8" autocomplete="${isLogin ? 'current-password' : 'new-password'}" />
        <p style="margin-top:16px"><button class="btn" type="submit">${isLogin ? '登录' : '注册'}</button></p>
      </form>
      <p class="small muted">${isLogin ? html`还没有账号？<a href="/app/signup">注册</a>` : html`已有账号？<a href="/app/login">登录</a>`}</p>
    </div>`,
  });
};

web.get('/login', async (c) => ((await currentUser(c)) ? c.redirect('/app') : c.html(authPage('login', undefined, c.req.query('next') ?? ''))));
web.get('/signup', async (c) => ((await currentUser(c)) ? c.redirect('/app') : c.html(authPage('signup'))));

web.post('/signup', async (c) => {
  if (!sameOrigin(c)) return c.text('forbidden', 403);
  const f = await c.req.formData();
  const email = field(f, 'email').toLowerCase();
  const password = String(f.get('password') ?? '');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return c.html(authPage('signup', '邮箱格式不对'));
  if (password.length < 8) return c.html(authPage('signup', '密码至少 8 位'));
  if (await findUserByEmail(email)) return c.html(authPage('signup', '这个邮箱已经注册过了，请直接登录'));
  const user = await createUser(email, password, field(f, 'name'));
  await adoptOrphanTenants(user);
  await startSession(c, user.id);
  return c.redirect('/app');
});

web.post('/login', async (c) => {
  if (!sameOrigin(c)) return c.text('forbidden', 403);
  const f = await c.req.formData();
  const user = await findUserByEmail(field(f, 'email'));
  const ok = user && (await verifyPassword(String(f.get('password') ?? ''), user.passwordHash));
  if (!ok) return c.html(authPage('login', '邮箱或密码不对', field(f, 'next')));
  await adoptOrphanTenants(user);
  await startSession(c, user.id);
  const next = field(f, 'next');
  return c.redirect(next.startsWith('/app') ? next : '/app');
});

web.post('/logout', async (c) => {
  await endSession(c);
  return c.redirect('/app/login');
});

/* ---------------- everything below requires login ---------------- */
web.use('/*', requireUser);

web.get('/', async (c) => {
  const user = c.get('user');
  const tenants = await tenantsFor(user);
  const stats = await Promise.all(tenants.map((t) => tenantStats(t.id)));
  return c.html(
    layout({
      title: '我的助理',
      user,
      body: html`<div class="row" style="justify-content:space-between"><h1>我的助理</h1><a class="btn" href="/app/new">＋ 新建助理</a></div>
        ${tenants.length === 0
          ? html`<div class="card"><p>还没有助理。填一个网址，两分钟就能生成第一个。</p><a class="btn" href="/app/new">新建助理</a></div>`
          : html`<table><tr><th>名称</th><th>本月消息</th><th>线索</th><th>新线索</th><th>创建</th><th></th></tr>
              ${tenants.map(
                (t, i) => html`<tr>
                  <td><a href="/app/t/${t.id}"><b>${t.name}</b></a><div class="small muted">${t.id}${t.ownerUserId ? '' : ' · 未认领'}</div></td>
                  <td>${stats[i].userMessagesThisMonth}${t.monthlyLimit ? ` / ${t.monthlyLimit}` : ''}</td>
                  <td>${stats[i].leads}</td>
                  <td>${stats[i].newLeads ? html`<span class="pill new">${stats[i].newLeads}</span>` : '0'}</td>
                  <td class="small muted">${fmtDate(t.createdAt)}</td>
                  <td><a class="btn ghost sm" href="/app/t/${t.id}">管理</a></td>
                </tr>`,
              )}
            </table>`}`,
    }),
  );
});

/* ---------------- create ---------------- */

const newPage = (user: User, err?: string, values: Partial<Record<string, string>> = {}) =>
  layout({
    title: '新建助理',
    user,
    body: html`<h1>新建助理</h1>
      <p class="sub">填网址，我们抓取你的网站整理成知识文档；没有网站也可以先手动写。</p>
      ${flash('err', err)}
      <form method="post" action="/app/new" class="card" id="newForm">
        <label>业务名称</label><input type="text" name="name" required maxlength="80" value="${values.name ?? ''}" placeholder="例如：Carrie Kwai 地产、老王川菜馆" />
        <label>网站网址 <small>（可选，填了会自动抓取生成知识文档，约 20–40 秒）</small></label><input type="url" name="websiteUrl" value="${values.websiteUrl ?? ''}" placeholder="https://" />
        <label>接待人姓名 <small>（助理会说"我是 XX 的 AI 助理"）</small></label><input type="text" name="ownerName" required maxlength="40" value="${values.ownerName ?? ''}" placeholder="例如：Carrie、William" />
        <label>一句话介绍这个人 / 生意 <small>（英文或中文都行）</small></label><input type="text" name="ownerDescription" maxlength="200" value="${values.ownerDescription ?? ''}" placeholder="例如：a licensed realtor in Richmond, BC / 温哥华的川菜馆" />
        <label>线索通知邮箱</label><input type="email" name="notifyEmail" required value="${values.notifyEmail ?? user.email}" />
        <p style="margin-top:16px"><button class="btn" type="submit" id="newBtn">创建</button> <span class="small muted" id="newHint"></span></p>
      </form>
      <script>
        document.getElementById('newForm').addEventListener('submit', function () {
          var b = document.getElementById('newBtn'); b.disabled = true; b.textContent = '正在生成…';
          if (document.querySelector('[name=websiteUrl]').value) document.getElementById('newHint').textContent = '正在抓取网站并整理知识文档，请稍候 20–40 秒。';
        });
      </script>`,
  });

web.get('/new', (c) => c.html(newPage(c.get('user'))));

web.post('/new', async (c) => {
  if (!sameOrigin(c)) return c.text('forbidden', 403);
  const user = c.get('user');
  const f = await c.req.formData();
  const values = { name: field(f, 'name'), websiteUrl: field(f, 'websiteUrl'), ownerName: field(f, 'ownerName'), ownerDescription: field(f, 'ownerDescription'), notifyEmail: field(f, 'notifyEmail') };
  if (!values.name || !values.ownerName) return c.html(newPage(user, '名称和接待人姓名必填', values));

  let knowledgeMd = `# ${values.name}\n\n## 关于 / About\n（请填写）\n\n## 服务 / Services\n- \n\n## 价格 / Pricing\n价格请与我们联系。\n\n## 常见问题 / FAQ\n**Q:** \n\n## 联系 / Contact\n邮箱：${values.notifyEmail}\n`;
  let importNote = '';
  if (values.websiteUrl) {
    try {
      const r = await importFromWebsite(values.websiteUrl);
      knowledgeMd = r.knowledgeMd;
      importNote = `已从 ${r.pagesUsed.length} 个页面生成知识文档，请检查并修正。`;
    } catch (err) {
      importNote = `网站抓取失败（${err instanceof Error ? err.message : String(err)}），已生成空白模板，请手动填写。`;
    }
  }

  let origins: string[] = [];
  try {
    if (values.websiteUrl) origins = [new URL(values.websiteUrl).origin];
  } catch {
    /* ignore */
  }

  const input: TenantInput = {
    name: values.name,
    ownerName: values.ownerName,
    ownerDescription: values.ownerDescription,
    extraRules: '',
    replySla: 'within 24 hours',
    websiteUrl: values.websiteUrl,
    knowledgeMd,
    bookingUrl: '',
    notify: { channel: 'email', email: values.notifyEmail },
    widget: { title: `${values.name} AI 助理`, color: '#1f6feb' },
    allowedOrigins: origins,
  };
  const t = await createTenant(user, input);
  return c.redirect(`/app/t/${t.id}/knowledge?msg=${encodeURIComponent(importNote || '已创建。先看看知识文档，然后在右侧试聊。')}`);
});

/* ---------------- per-tenant pages ---------------- */

async function loadTenant(c: any) {
  const t = await tenantFor(c.get('user'), c.req.param('id'));
  return t ?? null;
}

web.get('/t/:id', async (c) => {
  const user = c.get('user');
  const t = await loadTenant(c);
  if (!t) return c.text('not found', 404);
  const s = await tenantStats(t.id);
  const origin = appOrigin(c);
  const recent = await db.select().from(schema.leads).where(eq(schema.leads.tenantId, t.id)).orderBy(desc(schema.leads.createdAt)).limit(5).all();
  return c.html(
    layout({
      title: t.name,
      user,
      tenantNav: { id: t.id, name: t.name, active: 'overview' },
      body: html`${flash('ok', c.req.query('msg'))}
        <div class="grid">
          <div class="card stat"><b>${s.userMessagesThisMonth}${t.monthlyLimit ? html`<span class="small muted"> / ${t.monthlyLimit}</span>` : ''}</b><span>本月消息</span></div>
          <div class="card stat"><b>${s.conversations}</b><span>对话总数</span></div>
          <div class="card stat"><b>${s.leads}</b><span>线索总数</span></div>
          <div class="card stat"><b>${s.newLeads}</b><span>待跟进线索</span></div>
        </div>
        <div class="two">
          <div class="card">
            <h2 style="margin-top:0">嵌入到你的网站</h2>
            <p class="small muted">把这一行加到网页 <code>&lt;/body&gt;</code> 前（Squarespace / Wix / WordPress 都有"自定义代码"或"页脚代码"设置）。只有 <a href="/app/t/${t.id}/settings">设置</a> 里允许的域名才能使用。</p>
            <pre>${embedCode(t, origin)}</pre>
          </div>
          <div class="card">
            <h2 style="margin-top:0">独立聊天页</h2>
            <p class="small muted">没有网站也能用：把这个链接放到微信、名片或 Google 商家资料上。</p>
            <p><a href="/a/${t.id}" target="_blank">${origin}/a/${t.id}</a></p>
            <p><a class="btn ghost sm" href="/a/${t.id}" target="_blank">打开试聊</a></p>
          </div>
        </div>
        <h2>最近线索</h2>
        ${recent.length === 0
          ? html`<p class="muted">还没有线索。</p>`
          : html`<table><tr><th>时间</th><th>姓名</th><th>需求</th><th>联系方式</th><th>状态</th></tr>
              ${recent.map(
                (l) => html`<tr><td class="small muted">${fmtDate(l.createdAt)}</td><td>${l.name ?? '-'}</td><td>${l.need ?? '-'}</td><td>${l.contact ?? '-'}</td><td><span class="pill ${l.status}">${l.status}</span></td></tr>`,
              )}
            </table>
            <p><a href="/app/t/${t.id}/leads">全部线索 →</a></p>`}`,
    }),
  );
});

web.get('/t/:id/knowledge', async (c) => {
  const user = c.get('user');
  const t = await loadTenant(c);
  if (!t) return c.text('not found', 404);
  const origin = appOrigin(c);
  const w = parseJson<{ title?: string; color?: string; greeting?: string }>(t.widgetConfig, {});
  return c.html(
    layout({
      title: `${t.name} · 知识文档`,
      user,
      tenantNav: { id: t.id, name: t.name, active: 'knowledge' },
      body: html`${flash('ok', c.req.query('msg'))}
        <div class="two">
          <div>
            <form method="post" action="/app/t/${t.id}/knowledge">
              <p class="small muted">助理只根据这份文档回答。写清楚服务、价格区间、流程、常见问题和联系方式。保存后立即生效。</p>
              <textarea class="tall" name="knowledgeMd">${t.knowledgeMd}</textarea>
              <p class="row" style="margin-top:12px">
                <button class="btn" type="submit">保存</button>
                ${t.websiteUrl ? html`<button class="btn ghost" type="submit" formaction="/app/t/${t.id}/reimport" onclick="return confirm('会用网站内容重新生成并覆盖当前文档，确定？')">从网站重新生成</button>` : ''}
                <span class="small muted">${t.knowledgeMd.length} 字符</span>
              </p>
            </form>
          </div>
          <div>
            <div class="card" style="position:sticky;top:12px">
              <h2 style="margin-top:0">试聊</h2>
              <p class="small muted">和真实访客看到的一样。改完文档保存后刷新本页再试。</p>
              <div id="tryhost" style="position:relative;height:520px;border:1px solid var(--line);border-radius:12px;overflow:hidden;background:#f6f7f9"></div>
            </div>
          </div>
        </div>
        <script>
          (function(){
            var s=document.createElement('script'); s.src='/widget.js'; s.dataset.tenant='${t.id}'; s.dataset.title='${(w.title ?? t.name).replace(/'/g, '')}';
            ${w.color ? html`s.dataset.color='${w.color}';` : ''} ${w.greeting ? html`s.dataset.greeting='${w.greeting.replace(/'/g, '')}';` : ''}
            s.dataset.inline='tryhost'; document.body.appendChild(s);
          })();
        </script>`,
    }),
  );
});

web.post('/t/:id/knowledge', async (c) => {
  if (!sameOrigin(c)) return c.text('forbidden', 403);
  const t = await loadTenant(c);
  if (!t) return c.text('not found', 404);
  const f = await c.req.formData();
  const input = inputFromTenant(t);
  input.knowledgeMd = String(f.get('knowledgeMd') ?? '').slice(0, 60_000);
  await updateTenant(t, input);
  return c.redirect(`/app/t/${t.id}/knowledge?msg=${encodeURIComponent('已保存')}`);
});

web.post('/t/:id/reimport', async (c) => {
  if (!sameOrigin(c)) return c.text('forbidden', 403);
  const t = await loadTenant(c);
  if (!t || !t.websiteUrl) return c.text('not found', 404);
  const input = inputFromTenant(t);
  try {
    const r = await importFromWebsite(t.websiteUrl);
    input.knowledgeMd = r.knowledgeMd;
    await updateTenant(t, input);
    return c.redirect(`/app/t/${t.id}/knowledge?msg=${encodeURIComponent(`已从 ${r.pagesUsed.length} 个页面重新生成`)}`);
  } catch (err) {
    return c.redirect(`/app/t/${t.id}/knowledge?msg=${encodeURIComponent('抓取失败：' + (err instanceof Error ? err.message : String(err)))}`);
  }
});

web.get('/t/:id/settings', async (c) => {
  const user = c.get('user');
  const t = await loadTenant(c);
  if (!t) return c.text('not found', 404);
  const i = inputFromTenant(t);
  return c.html(
    layout({
      title: `${t.name} · 设置`,
      user,
      tenantNav: { id: t.id, name: t.name, active: 'settings' },
      body: html`${flash('ok', c.req.query('msg'))}
        <form method="post" action="/app/t/${t.id}/settings">
          <div class="two">
            <div class="card">
              <h2 style="margin-top:0">基本</h2>
              <label>名称</label><input type="text" name="name" required maxlength="80" value="${i.name}" />
              <label>接待人姓名</label><input type="text" name="ownerName" required maxlength="40" value="${i.ownerName}" />
              <label>一句话介绍</label><input type="text" name="ownerDescription" maxlength="200" value="${i.ownerDescription}" />
              <label>网站</label><input type="url" name="websiteUrl" value="${i.websiteUrl}" />
              <label>预约链接 <small>（Cal.com / Calendly / WhatsApp 链接，意向明确时助理会给出）</small></label><input type="url" name="bookingUrl" value="${i.bookingUrl}" placeholder="https://cal.com/..." />
              <label>承诺回复时间 <small>（助理转人工时告诉客户）</small></label><input type="text" name="replySla" value="${i.replySla}" placeholder="within 24 hours / 24 小时内" />
              <label>额外规则 <small>（每行一条，例如"用繁体回答"、"不谈折扣"）</small></label><textarea name="extraRules" style="min-height:110px">${i.extraRules}</textarea>
            </div>
            <div>
              <div class="card">
                <h2 style="margin-top:0">通知</h2>
                <label>线索通知邮箱</label><input type="email" name="notifyEmail" value="${i.notify.email ?? ''}" />
                <label>Telegram <small>（可选：填了就优先用 Telegram）</small></label>
                <div class="two"><input type="text" name="tgToken" placeholder="Bot token" value="${i.notify.telegram?.botToken ?? ''}" /><input type="text" name="tgChat" placeholder="Chat ID" value="${i.notify.telegram?.chatId ?? ''}" /></div>
              </div>
              <div class="card">
                <h2 style="margin-top:0">挂件外观</h2>
                <label>标题</label><input type="text" name="wTitle" maxlength="60" value="${i.widget.title ?? ''}" />
                <label>主题色</label><input type="color" name="wColor" value="${i.widget.color ?? '#1f6feb'}" />
                <label>开场白 <small>（留空用默认）</small></label><input type="text" name="wGreeting" maxlength="200" value="${i.widget.greeting ?? ''}" />
                <label>位置</label><select name="wPosition"><option value="right" ${i.widget.position !== 'left' ? 'selected' : ''}>右下角</option><option value="left" ${i.widget.position === 'left' ? 'selected' : ''}>左下角</option></select>
              </div>
              <div class="card">
                <h2 style="margin-top:0">允许嵌入的网站</h2>
                <p class="small muted">一行一个域名。只有这些网站能挂这个助理，防止别人盗用。</p>
                <textarea name="allowedOrigins" style="min-height:80px">${i.allowedOrigins.join('\n')}</textarea>
              </div>
            </div>
          </div>
          <p><button class="btn" type="submit">保存设置</button></p>
        </form>
        ${user.role === 'admin'
          ? html`<div class="card" style="border-color:#bcd3f7">
              <h2 style="margin-top:0">额度 <span class="pill">仅管理员可见</span></h2>
              <form method="post" action="/app/t/${t.id}/limit" class="row">
                <label style="margin:0">每月消息上限 <small>（访客消息条数，0 = 不限）</small></label>
                <input type="number" name="monthlyLimit" min="0" step="1" value="${t.monthlyLimit}" style="width:140px" />
                <button class="btn sm" type="submit">保存额度</button>
                <span class="small muted">归属：${t.ownerUserId ?? '未认领'} · 本月已用见概览</span>
              </form>
            </div>`
          : ''}
        <div class="card" style="border-color:#f3c9c5">
          <h2 style="margin-top:0">删除助理</h2>
          <p class="small muted">会删除这个助理的全部对话和线索，不可恢复。</p>
          <form method="post" action="/app/t/${t.id}/delete" onsubmit="return confirm('确定删除 ${t.name} 及其全部数据？')"><button class="btn danger" type="submit">删除</button></form>
        </div>`,
    }),
  );
});

web.post('/t/:id/settings', async (c) => {
  if (!sameOrigin(c)) return c.text('forbidden', 403);
  const t = await loadTenant(c);
  if (!t) return c.text('not found', 404);
  const f = await c.req.formData();
  const tgToken = field(f, 'tgToken');
  const tgChat = field(f, 'tgChat');
  const email = field(f, 'notifyEmail');
  const input: TenantInput = {
    name: field(f, 'name'),
    ownerName: field(f, 'ownerName'),
    ownerDescription: field(f, 'ownerDescription'),
    extraRules: field(f, 'extraRules'),
    replySla: field(f, 'replySla'),
    websiteUrl: field(f, 'websiteUrl'),
    knowledgeMd: t.knowledgeMd,
    bookingUrl: field(f, 'bookingUrl'),
    notify: tgToken && tgChat ? { channel: 'telegram', telegram: { botToken: tgToken, chatId: tgChat }, email } : email ? { channel: 'email', email } : { channel: 'console' },
    widget: { title: field(f, 'wTitle'), color: field(f, 'wColor'), greeting: field(f, 'wGreeting'), position: field(f, 'wPosition') === 'left' ? 'left' : 'right' },
    allowedOrigins: field(f, 'allowedOrigins').split(/\r?\n/),
  };
  await updateTenant(t, input);
  return c.redirect(`/app/t/${t.id}/settings?msg=${encodeURIComponent('已保存')}`);
});

web.post('/t/:id/limit', async (c) => {
  if (!sameOrigin(c)) return c.text('forbidden', 403);
  if (c.get('user').role !== 'admin') return c.text('forbidden', 403);
  const t = await loadTenant(c);
  if (!t) return c.text('not found', 404);
  const f = await c.req.formData();
  const n = Math.max(0, Math.floor(Number(f.get('monthlyLimit'))));
  if (!Number.isFinite(n)) return c.text('bad number', 400);
  await db.update(schema.tenants).set({ monthlyLimit: n }).where(eq(schema.tenants.id, t.id)).run();
  return c.redirect(`/app/t/${t.id}/settings?msg=${encodeURIComponent(n === 0 ? '额度已设为不限' : `额度已设为每月 ${n} 条`)}`);
});

web.post('/t/:id/delete', async (c) => {
  if (!sameOrigin(c)) return c.text('forbidden', 403);
  const t = await loadTenant(c);
  if (!t) return c.text('not found', 404);
  if (t.id === 'default') return c.text('the default tenant cannot be deleted', 400);
  await deleteTenant(t.id);
  return c.redirect('/app');
});

/* ---------------- leads & conversations ---------------- */

web.get('/t/:id/leads', async (c) => {
  const user = c.get('user');
  const t = await loadTenant(c);
  if (!t) return c.text('not found', 404);
  const rows = await db.select().from(schema.leads).where(eq(schema.leads.tenantId, t.id)).orderBy(desc(schema.leads.createdAt)).limit(200).all();
  return c.html(
    layout({
      title: `${t.name} · 线索`,
      user,
      tenantNav: { id: t.id, name: t.name, active: 'leads' },
      body: html`${flash('ok', c.req.query('msg'))}
        ${rows.length === 0
          ? html`<p class="muted">还没有线索。访客留下联系方式后会出现在这里。</p>`
          : html`<table><tr><th>时间</th><th>姓名 / 公司</th><th>需求</th><th>预算 / 时间</th><th>联系方式</th><th>状态</th><th></th></tr>
              ${rows.map(
                (l) => html`<tr>
                  <td class="small muted">${fmtDate(l.createdAt)}</td>
                  <td>${l.name ?? '-'}<div class="small muted">${l.company ?? ''}</div></td>
                  <td>${l.need ?? '-'}</td>
                  <td class="small">${l.budget ?? '-'}<br />${l.timeline ?? ''}</td>
                  <td>${l.contact ?? '-'}</td>
                  <td>
                    <form method="post" action="/app/t/${t.id}/leads/${l.id}/status" style="margin:0">
                      <select name="status" onchange="this.form.submit()">
                        ${['new', 'contacted', 'won', 'lost'].map((s) => html`<option value="${s}" ${s === l.status ? 'selected' : ''}>${{ new: '待跟进', contacted: '已联系', won: '成交', lost: '放弃' }[s]}</option>`)}
                      </select>
                    </form>
                  </td>
                  <td><a class="small" href="/app/t/${t.id}/conversations/${l.conversationId}">对话</a></td>
                </tr>`,
              )}
            </table>`}`,
    }),
  );
});

web.post('/t/:id/leads/:leadId/status', async (c) => {
  if (!sameOrigin(c)) return c.text('forbidden', 403);
  const t = await loadTenant(c);
  if (!t) return c.text('not found', 404);
  const f = await c.req.formData();
  const status = field(f, 'status');
  if (!['new', 'contacted', 'won', 'lost'].includes(status)) return c.text('bad status', 400);
  await db.update(schema.leads).set({ status }).where(and(eq(schema.leads.id, c.req.param('leadId')), eq(schema.leads.tenantId, t.id))).run();
  return c.redirect(`/app/t/${t.id}/leads`);
});

web.get('/t/:id/conversations', async (c) => {
  const user = c.get('user');
  const t = await loadTenant(c);
  if (!t) return c.text('not found', 404);
  const convs = await db.select().from(schema.conversations).where(eq(schema.conversations.tenantId, t.id)).orderBy(desc(schema.conversations.startedAt)).limit(100).all();
  const firsts = await Promise.all(
    convs.map((cv) =>
      db.select({ content: schema.messages.content }).from(schema.messages).where(and(eq(schema.messages.conversationId, cv.id), eq(schema.messages.role, 'user'))).orderBy(asc(schema.messages.createdAt)).limit(1).get(),
    ),
  );
  return c.html(
    layout({
      title: `${t.name} · 对话`,
      user,
      tenantNav: { id: t.id, name: t.name, active: 'conversations' },
      body: html`${convs.length === 0
        ? html`<p class="muted">还没有对话。</p>`
        : html`<table><tr><th>开始时间</th><th>访客第一句</th><th>访客</th><th></th></tr>
            ${convs.map(
              (cv, i) => html`<tr>
                <td class="small muted">${fmtDate(cv.startedAt)}</td>
                <td>${(firsts[i]?.content ?? '').slice(0, 80)}</td>
                <td class="small muted">${cv.visitorId.slice(0, 12)}${cv.ip ? ` · ${cv.ip}` : ''}</td>
                <td><a href="/app/t/${t.id}/conversations/${cv.id}">查看</a></td>
              </tr>`,
            )}
          </table>`}`,
    }),
  );
});

web.get('/t/:id/conversations/:cid', async (c) => {
  const user = c.get('user');
  const t = await loadTenant(c);
  if (!t) return c.text('not found', 404);
  const cid = c.req.param('cid');
  const conv = await db.select().from(schema.conversations).where(and(eq(schema.conversations.id, cid), eq(schema.conversations.tenantId, t.id))).get();
  if (!conv) return c.text('not found', 404);
  const msgs = await db.select().from(schema.messages).where(eq(schema.messages.conversationId, cid)).orderBy(asc(schema.messages.createdAt)).all();
  const lead = await db.select().from(schema.leads).where(eq(schema.leads.conversationId, cid)).get();
  return c.html(
    layout({
      title: `${t.name} · 对话记录`,
      user,
      tenantNav: { id: t.id, name: t.name, active: 'conversations' },
      body: html`<p class="small muted">对话 ${cid} · 开始于 ${fmtDate(conv.startedAt)} · 访客 ${conv.visitorId.slice(0, 12)}${conv.ip ? ` · ${conv.ip}` : ''}</p>
        ${lead
          ? html`<div class="card"><b>线索</b>：${lead.name ?? '-'} · ${lead.contact ?? '-'} · ${lead.need ?? '-'} <span class="pill ${lead.status}">${lead.status}</span></div>`
          : ''}
        <div class="chat">
          ${msgs.map((m) => {
            if (m.role === 'tool') return html`<div class="bubble tool">tool → ${m.content.slice(0, 200)}</div>`;
            if (m.role === 'assistant' && !m.content && m.meta) {
              const calls = parseJson<any[]>(m.meta, []);
              return html`<div class="bubble tool">${calls.map((x) => `${x.function?.name}(${(x.function?.arguments ?? '').slice(0, 160)})`).join(' · ')}</div>`;
            }
            return html`<div class="bubble ${m.role}">${m.content}</div>`;
          })}
        </div>
        <p style="margin-top:16px"><a href="/app/t/${t.id}/conversations">← 全部对话</a></p>`,
    }),
  );
});

/* ---------------- hosted chat page (public) ---------------- */

export function hostedPage(t: { id: string; name: string; widgetConfig: string }): string {
  const w = parseJson<{ title?: string; color?: string; greeting?: string }>(t.widgetConfig, {});
  const attrs = [`data-tenant="${t.id}"`, `data-title="${(w.title ?? t.name).replace(/"/g, '&quot;')}"`, w.color ? `data-color="${w.color}"` : '', w.greeting ? `data-greeting="${w.greeting.replace(/"/g, '&quot;')}"` : '', 'data-inline="host"'].filter(Boolean).join(' ');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><meta name="robots" content="noindex" />
<title>${(w.title ?? t.name).replace(/</g, '&lt;')}</title>
<style>html,body{margin:0;height:100%;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif}#host{position:fixed;inset:0;max-width:720px;margin:0 auto}@media(min-width:721px){#host{top:24px;bottom:24px;border-radius:16px;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.15)}}</style>
</head><body><div id="host"></div><script src="/widget.js" ${attrs}></script></body></html>`;
}

export { config as _cfg };
