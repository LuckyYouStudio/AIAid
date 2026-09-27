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
src/server.ts            Hono + SSE
src/cli.ts               终端测试
```

## 下一步

- 可嵌入聊天挂件（一行 `<script>`）
- Telegram 通知实测（`NOTIFY_CHANNEL=telegram` + Bot token / chat id）
- 简单后台：对话记录、线索列表、登录保护
