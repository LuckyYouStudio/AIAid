import OpenAI from 'openai';
import { config } from '../config.js';

export const openai = new OpenAI({
  apiKey: config.openaiApiKey,
  baseURL: config.openaiBaseUrl,
});

export type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export interface StreamResult {
  content: string;
  toolCalls: { id: string; name: string; arguments: string }[];
}

/** Streams one completion; emits text deltas via onToken and accumulates tool calls. */
export async function streamCompletion(
  messages: ChatMessage[],
  tools: OpenAI.Chat.Completions.ChatCompletionTool[],
  onToken: (t: string) => void,
): Promise<StreamResult> {
  const stream = await openai.chat.completions.create({
    model: config.openaiModel,
    messages,
    tools,
    stream: true,
  });

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
