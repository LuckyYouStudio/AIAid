# AIaid — AI 接待助理

个人 AI 接待助理，也是未来多租户 AI 客服 SaaS 的原型。详见 [CLAUDE.md](CLAUDE.md)。

## 快速开始

```bash
npm install
cp .env.example .env        # 填入 OPENAI_API_KEY，改 BOOKING_URL 等
npm run db:push             # 建表（SQLite，data/app.db）
npm run db:seed             # 用 knowledge/knowledge.md + .env 写入默认租户
npm run cli                 # 终端对话测试
npm run dev                 # 启动 HTTP 服务（默认 3000）
```

改了 `knowledge/knowledge.md` 或 `.env` 里的租户配置后，重新 `npm run db:seed` 即可。

## 接口

`POST /api/chat`，body：`{ "message": "...", "conversationId?": "...", "visitorId?": "...", "tenantId?": "default" }`

返回 SSE：`conversation`（会话 id）→ `token`*（流式文本）/ `tool`（工具名）→ `done` | `error`。

```bash
curl -N -X POST localhost:3000/api/chat -H 'content-type: application/json' -d '{"message":"你们做什么？"}'
```

## 目录

```
knowledge/knowledge.md   服务介绍 / 价格区间 / FAQ（整体进 system prompt）
src/config.ts            环境变量
src/db/schema.ts         tenants / conversations / messages / leads（都带 tenant_id）
src/db/seed.ts           默认租户
src/llm/prompt.ts        行为约束 + 知识拼装
src/llm/tools.ts         save_lead / notify_owner 定义
src/llm/openai.ts        流式调用 + tool call 累积
src/notify/              console / telegram 通知（邮件预留）
src/services/chat.ts     对话循环：持久化、工具执行、流式事件
src/dev.ts               本地 Node 服务：Hono + 静态文件（/ 官网，/widget.js 挂件）
public/widget.js         可嵌入聊天挂件，一行 <script> 接入
public/index.html        演示页
src/cli.ts               终端测试
```

## 下一步

- ~~可嵌入聊天挂件~~ 已完成：`public/widget.js`，演示页 `public/index.html`（启动服务后打开 http://localhost:3000）
- Telegram 通知实测（`NOTIFY_CHANNEL=telegram` + Bot token / chat id）
- 简单后台：对话记录、线索列表、登录保护

## 部署到 Vercel + Turso

线上地址：https://www.the5288.com （备用 https://aiaid-sepia.vercel.app；推送 `main` 自动部署）

Vercel 无持久文件系统，线上数据库用 Turso（云端 SQLite）。

1. **Turso**：`turso db create aiaid` 或在 turso.tech 控制台建库，拿到 `libsql://...` URL 和 auth token。
2. **本地建表并写入租户**（临时指向线上库）：
   ```bash
   DATABASE_URL=libsql://xxx.turso.io DATABASE_AUTH_TOKEN=xxx npm run db:push
   DATABASE_URL=libsql://xxx.turso.io DATABASE_AUTH_TOKEN=xxx npm run db:seed
   ```
3. **Vercel**：导入 GitHub 仓库，Framework 选 Other，环境变量填 `.env.example` 里的全部项（`DATABASE_URL` 用 Turso 地址）。
4. 每次改 `knowledge/knowledge.md` 后，重新执行第 2 步的 seed。

入口：`api/index.ts`（Hono 的 Vercel 适配），静态文件由 Vercel 直接从 `public/` 提供。
