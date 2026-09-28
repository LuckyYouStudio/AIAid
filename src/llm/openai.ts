import { OpenAI } from 'openai';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';
import { config } from '../config.js';

export const openai = new OpenAI({
  apiKey: config.openaiApiKey,
  baseURL: config.openaiBaseUrl,
});

export type ChatMessage = ChatCompletionMessageParam;

export interface StreamResult {
  content: string;
  toolCalls: { id: string; name: string; arguments: string }[];
}

/** Streams one completion; emits text deltas via onToken and accumulates tool calls. */
export async function streamCompletion(
  messages: ChatMessage[],
  tools: ChatCompletionTool[],
  onToken: (t: string) => void,
): Promise<StreamResult> {
  const params = {
    model: config.openaiModel,
    messages,
    tools,
    stream: true as const,
    max_completion_tokens: config.limits.maxOutputTokens,
  };
  // Relays occasionally return a transient 5xx/"overloaded" before any token is sent; retry once.
  let stream;
  try {
    stream = await openai.chat.completions.create(params);
  } catch (err: any) {
    const status = err?.status ?? 0;
    const transient = status >= 500 || status === 429 || /overloaded|timeout|ECONNRESET/i.test(String(err?.message));
    if (!transient) throw err;
    await new Promise((r) => setTimeout(r, 1500));
    stream = await openai.chat.completions.create({ ...params, model: config.openaiFallbackModel || params.model });
  }

  let content = '';
  const toolCalls: StreamResult['toolCalls'] = [];

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;
    if (!delta) continue;
    if (delta.content) {
      content += delta.content;
      onToken(delta.content);
    }
    for (const tc of delta.tool_calls ?? []) {
      const slot = (toolCalls[tc.index] ??= { id: '', name: '', arguments: '' });
      if (tc.id) slot.id = tc.id;
      if (tc.function?.name) slot.name += tc.function.name;
      if (tc.function?.arguments) slot.arguments += tc.function.arguments;
    }
  }
  return { content, toolCalls };
}
