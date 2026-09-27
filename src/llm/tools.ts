import type OpenAI from 'openai';

export const toolDefinitions: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'save_lead',
      description:
        'Save or update the structured lead for this conversation. Call once you know at least the need and a contact method. Omit fields you do not know yet.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Visitor name' },
          company: { type: 'string', description: 'Company or organisation' },
          need: { type: 'string', description: 'What they want built or solved, in one or two sentences' },
          budget: { type: 'string', description: 'Budget range as stated by the visitor' },
          timeline: { type: 'string', description: 'When they need it' },
          contact: { type: 'string', description: 'Email, phone, WeChat, etc.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'notify_owner',
      description:
        'Notify the owner that a human follow-up is needed (question you cannot answer, specific quote requested, or visitor asked for a human).',
      parameters: {
        type: 'object',
        properties: {
          reason: {
            type: 'string',
            enum: ['quote_request', 'cannot_answer', 'human_requested', 'hot_lead', 'other'],
          },
          summary: {
            type: 'string',
            description: 'Two or three sentences: who, what they need, what the owner should do',
          },
          lead_id: { type: 'string', description: 'The lead id returned by save_lead, if any' },
        },
        required: ['reason', 'summary'],
      },
    },
  },
];

export interface SaveLeadArgs {
  name?: string;
  company?: string;
  need?: string;
  budget?: string;
  timeline?: string;
  contact?: string;
}

export interface NotifyOwnerArgs {
  reason: 'quote_request' | 'cannot_answer' | 'human_requested' | 'hot_lead' | 'other';
  summary: string;
  lead_id?: string;
}
