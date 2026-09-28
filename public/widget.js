/* AIaid embeddable chat widget.
 * Usage: <script src="https://your-host/widget.js" data-tenant="default" data-title="William 的 AI 助理"></script>
 * Optional data- attributes: tenant, title, greeting, color, position (right|left), api (override API origin)
 */
(function () {
  'use strict';
  if (window.__aiaidLoaded) return;
  window.__aiaidLoaded = true;

  var script = document.currentScript;
  var ds = (script && script.dataset) || {};
  var apiBase = ds.api || (script && script.src ? new URL(script.src).origin : '');
  var tenant = ds.tenant || 'default';
  var title = ds.title || 'AI 助理';
  var color = ds.color || '#1f6feb';
  var side = ds.position === 'left' ? 'left' : 'right';
  // Follow the host page's <html lang> when set, otherwise the browser language.
  var langTag = ds.lang || document.documentElement.lang || navigator.language;
  var zh = /^zh/i.test(langTag);
  // Traditional Chinese UI labels for zh-HK / zh-TW / zh-Hant pages.
  var zht = /^zh-(hk|tw|mo|hant)/i.test(langTag);
  var L = zht
    ? { placeholder: '輸入訊息…', send: '傳送', sub: '通常幾秒內回覆', foot: 'AI 助理，非本人。', fail: '連線失敗，請稍後再試。' }
    : zh
      ? { placeholder: '输入消息…', send: '发送', sub: '通常几秒内回复', foot: 'AI 助理，非本人。', fail: '连接失败，请稍后再试。' }
      : { placeholder: 'Type a message…', send: 'Send', sub: 'Usually replies in seconds', foot: 'AI assistant, not a human.', fail: 'Connection failed, please try again.' };
  var greeting = ds.greeting || (zh
    ? '你好，我是 William 的 AI 助理。想了解服务、价格，或者约个时间聊聊，都可以问我。'
    : "Hi, I'm William's AI assistant. Ask me about services, pricing, or book a time to talk.");
  var placeholder = L.placeholder;
  var storageKey = 'aiaid:conversation:' + tenant;

  /* ---------- styles ---------- */
  var css = [
    '.aiaid-root{position:fixed;bottom:20px;' + side + ':20px;z-index:2147483000;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;font-size:15px;line-height:1.5}',
    '.aiaid-bubble{width:56px;height:56px;border-radius:50%;background:' + color + ';border:0;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.2);display:flex;align-items:center;justify-content:center;transition:transform .15s}',
    '.aiaid-bubble:hover{transform:scale(1.06)}',
    '.aiaid-bubble svg{width:26px;height:26px;fill:#fff}',
    '.aiaid-panel{position:absolute;bottom:70px;' + side + ':0;width:380px;max-width:calc(100vw - 40px);height:560px;max-height:calc(100vh - 110px);background:#fff;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.22);display:none;flex-direction:column;overflow:hidden}',
    '.aiaid-root.open .aiaid-panel{display:flex}',
    '.aiaid-head{background:' + color + ';color:#fff;padding:14px 16px;display:flex;align-items:center;justify-content:space-between}',
    '.aiaid-head b{font-size:15px}.aiaid-head small{display:block;opacity:.85;font-size:12px;font-weight:400}',
    '.aiaid-close{background:transparent;border:0;color:#fff;font-size:22px;cursor:pointer;line-height:1;padding:0 4px}',
    '.aiaid-msgs{flex:1;overflow-y:auto;padding:16px;background:#f6f7f9;display:flex;flex-direction:column;gap:10px}',
    '.aiaid-msg{max-width:85%;padding:10px 13px;border-radius:14px;white-space:pre-wrap;word-break:break-word}',
    '.aiaid-msg.user{align-self:flex-end;background:' + color + ';color:#fff;border-bottom-right-radius:4px}',
    '.aiaid-msg.bot{align-self:flex-start;background:#fff;color:#1a1a1a;border-bottom-left-radius:4px;box-shadow:0 1px 2px rgba(0,0,0,.06)}',
    '.aiaid-msg.bot a{color:' + color + ';text-decoration:underline}',
    '.aiaid-msg.bot.typing::after{content:"▍";animation:aiaid-blink 1s infinite}',
    '@keyframes aiaid-blink{50%{opacity:0}}',
    '.aiaid-msg.err{align-self:center;background:#fdecea;color:#b3261e;font-size:13px}',
    '.aiaid-form{display:flex;gap:8px;padding:12px;border-top:1px solid #e6e8eb;background:#fff}',
    '.aiaid-form textarea{flex:1;resize:none;border:1px solid #d0d4d9;border-radius:10px;padding:9px 12px;font:inherit;max-height:120px;outline:none}',
    '.aiaid-form textarea:focus{border-color:' + color + '}',
    '.aiaid-send{background:' + color + ';color:#fff;border:0;border-radius:10px;padding:0 16px;cursor:pointer;font:inherit}',
    '.aiaid-send:disabled{opacity:.5;cursor:default}',
    '.aiaid-foot{text-align:center;font-size:11px;color:#8a8f98;padding:0 0 8px;background:#fff}',
    '@media (max-width:480px){.aiaid-panel{position:fixed;inset:0;width:100%;max-width:none;height:100%;max-height:none;border-radius:0}.aiaid-root.open .aiaid-bubble{display:none}}',
  ].join('\n');
  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  /* ---------- DOM ---------- */
  var root = document.createElement('div');
  root.className = 'aiaid-root';
  root.innerHTML =
    '<div class="aiaid-panel" role="dialog" aria-label="' + esc(title) + '">' +
    '<div class="aiaid-head"><div><b>' + esc(title) + '</b><small>' + L.sub + '</small></div>' +
    '<button class="aiaid-close" aria-label="close">×</button></div>' +
    '<div class="aiaid-msgs"></div>' +
    '<form class="aiaid-form"><textarea rows="1" placeholder="' + esc(placeholder) + '"></textarea><button class="aiaid-send" type="submit">' + L.send + '</button></form>' +
    '<div class="aiaid-foot">' + L.foot + '</div>' +
    '</div>' +
    '<button class="aiaid-bubble" aria-label="chat"><svg viewBox="0 0 24 24"><path d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2z"/></svg></button>';
  document.body.appendChild(root);

  var panel = root.querySelector('.aiaid-panel');
  var msgs = root.querySelector('.aiaid-msgs');
  var form = root.querySelector('.aiaid-form');
  var input = root.querySelector('textarea');
  var sendBtn = root.querySelector('.aiaid-send');
  var conversationId = null;
  var visitorId = null;
  try {
    conversationId = localStorage.getItem(storageKey);
    visitorId = localStorage.getItem('aiaid:visitor');
    if (!visitorId) {
      visitorId = 'v-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem('aiaid:visitor', visitorId);
    }
  } catch (e) {}

  root.querySelector('.aiaid-bubble').addEventListener('click', function () {
    root.classList.toggle('open');
    if (root.classList.contains('open')) {
      // Re-read the page language at open time so a site-level language toggle is respected.
      if (!ds.lang && !ds.greeting) {
        zh = /^zh/i.test(document.documentElement.lang || navigator.language);
        greeting = zh
          ? '你好，我是 William 的 AI 助理。想了解服务、价格，或者约个时间聊聊，都可以问我。'
          : "Hi, I'm William's AI assistant. Ask me about services, pricing, or book a time to talk.";
        input.placeholder = zh ? '输入消息…' : 'Type a message…';
        sendBtn.textContent = zh ? '发送' : 'Send';
        root.querySelector('.aiaid-head small').textContent = zh ? '通常几秒内回复' : 'Usually replies in seconds';
        root.querySelector('.aiaid-foot').textContent = zh ? 'AI 助理，非本人。' : 'AI assistant, not a human.';
      }
      input.focus();
      if (!msgs.children.length) addMsg('bot', greeting);
    }
  });
  root.querySelector('.aiaid-close').addEventListener('click', function () { root.classList.remove('open'); });

  input.addEventListener('input', function () {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
  });
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var text = input.value.trim();
    if (!text || sendBtn.disabled) return;
    input.value = '';
    input.style.height = 'auto';
    send(text);
  });

  /* ---------- helpers ---------- */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // Minimal safe markdown: escape first, then bold / links / autolink.
  function render(text) {
    var h = esc(text);
    // Links first so a URL wrapped in **bold** still becomes clickable.
    h = h.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    h = h.replace(/(^|[^"=>])(https?:\/\/[^\s<*]+[^\s<*.,;:!?)])/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
    h = h.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    h = h.replace(/^\s*[-•]\s+/gm, '• ');
    return h;
  }
  function addMsg(role, text) {
    var el = document.createElement('div');
    el.className = 'aiaid-msg ' + role;
    if (role === 'bot') el.innerHTML = render(text); else el.textContent = text;
    msgs.appendChild(el);
    msgs.scrollTop = msgs.scrollHeight;
    return el;
  }

  function send(text) {
    addMsg('user', text);
    var bot = addMsg('bot', '');
    bot.classList.add('typing');
    var buf = '';
    var pendingReset = false;
    sendBtn.disabled = true;

    fetch(apiBase + '/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: text, conversationId: conversationId, visitorId: visitorId, tenantId: tenant }),
    }).then(function (res) {
      if (!res.ok) {
        // Server-side guard (rate limit, too long, origin) returns JSON { error }.
        return res.json().catch(function () { return {}; }).then(function (j) {
          throw new Error(j.error || ('HTTP ' + res.status));
        });
      }
      if (!res.body) throw new Error('HTTP ' + res.status);
      var reader = res.body.getReader();
      var dec = new TextDecoder();
      var pending = '';
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) return;
          pending += dec.decode(r.value, { stream: true });
          var parts = pending.split('\n\n');
          pending = parts.pop();
          parts.forEach(handleEvent);
          return pump();
        });
      }
      return pump();
    }).catch(function (err) {
      bot.remove();
      addMsg('err', err.message || L.fail);
    }).then(function () {
      bot.classList.remove('typing');
      if (!buf && bot.parentNode) bot.remove();
      sendBtn.disabled = false;
      input.focus();
    });

    function handleEvent(block) {
      var event = 'message', data = [];
      block.split('\n').forEach(function (line) {
        if (line.indexOf('event:') === 0) event = line.slice(6).trim();
        else if (line.indexOf('data:') === 0) data.push(line.slice(5).replace(/^ /, ''));
      });
      var payload = data.join('\n');
      if (event === 'conversation') {
        conversationId = payload;
        try { localStorage.setItem(storageKey, payload); } catch (e) {}
      } else if (event === 'token') {
        // After a tool call the model rewrites its reply; replace instead of appending.
        if (pendingReset) { buf = ''; pendingReset = false; }
        buf += payload;
        bot.innerHTML = render(buf);
        msgs.scrollTop = msgs.scrollHeight;
      } else if (event === 'reset') {
        pendingReset = true;
      } else if (event === 'error') {
        // Model/provider errors are not actionable for visitors; show a short generic line.
        addMsg('err', /overloaded|rate limit|timeout|5\d\d/i.test(payload) ? L.fail : payload);
      }
    }
  }
})();
