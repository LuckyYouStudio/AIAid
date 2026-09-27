# 项目：个人 AI 接待助理（未来 AI 客服 SaaS 的样板）

## 背景
我是独立开发者 William，提供 IT / AI 技术服务。这个项目先做我自己的 AI 接待助理，
挂在我的网站上接待潜在客户；同时它是我以后卖给小企业的 AI 客服 SaaS 的原型和 Demo。
所以代码要从第一天就按多租户 SaaS 的骨架来写，但当前只有我一个租户。

## MVP 功能（只做这四件事）
1. 回答问题：服务范围、价格区间、交付周期、常见问题，中英文自动切换。
2. 筛选线索：对话中自然收集姓名、公司、需求、预算、时间、联系方式，保存为结构化线索。
3. 预约：意向明确时给出预约链接（Cal.com / Calendly，链接从配置读取）。
4. 转人工：答不了或涉及具体报价时，通知我（先做 Telegram Bot，预留邮件接口），并告诉客户多久内回复。

暂不做：多渠道接入（微信/WhatsApp）、知识库上传、向量检索、自动报价、计费。

## 技术方案
- 后端：Node.js + TypeScript，SQLite 起步（通过 ORM 或抽象层，方便以后换 Postgres）。
- LLM：官方 API，使用 tool use / function calling 和 prompt caching。
- 知识：服务介绍、价格区间、FAQ 写在一份 Markdown 文档里，整体放入 system prompt，不做 RAG。
- 工具定义：
  - `save_lead`：name, company, need, budget, timeline, contact
  - `notify_owner`：reason, summary, lead_id（可选）
- 前端：可嵌入的聊天挂件，一行 `<script>` 挂到任何网站；支持流式输出。
- 部署：我现有的 AWS。

## 数据模型（所有表带 tenant_id）
- tenants：id, name, system_prompt, knowledge_md, booking_url, notify_config
- conversations：id, tenant_id, visitor_id, started_at, language
- messages：id, conversation_id, role, content, created_at
- leads：id, tenant_id, conversation_id, name, company, need, budget, timeline, contact, status, created_at

## 行为约束（写进 system prompt）
- 开场说明自己是 William 的 AI 助理，不冒充本人。
- 收集联系方式前说明用途（符合 PIPEDA / BC PIPA）。
- 不承诺具体价格、交付日期、折扣，只给区间；具体的转交给 William。
- 不确定时说不确定，并转人工，不编造。

## 里程碑
- 第 1 周：核心对话 + 两个工具 + Telegram 通知 + 挂件上线。
- 第 2 周：简单后台（对话记录、线索列表，带登录保护）。

## 开发要求
- 配置项（API key、Bot token、预约链接）全部走环境变量，提供 `.env.example`。
- 先写一个最小可跑版本，再逐步加功能；每一步都能本地运行测试。
