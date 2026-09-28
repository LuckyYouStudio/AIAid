import type { Lead } from '../db/schema.js';
import { sendEmail } from './email.js';

export interface OwnerNotification {
  reason: string;
  summary: string;
  conversationId: string;
  lead?: Lead | null;
  /** Deep link to the conversation in the dashboard, when known. */
  link?: string;
}

export interface Notifier {
  send(n: OwnerNotification): Promise<void>;
}

export interface NotifyConfig {
  channel?: 'console' | 'telegram' | 'email';
  email?: string;
  replySla?: string;
  telegram?: { botToken?: string; chatId?: string };
}

export function formatNotification(n: OwnerNotification): string {
  const lines = [`[Hand-off needed] reason: ${n.reason}`, n.summary, `Conversation: ${n.conversationId}`];
  if (n.lead) {
    lines.push(
      '--- Lead ---',
      `Name: ${n.lead.name ?? '-'} | Company: ${n.lead.company ?? '-'}`,
      `Need: ${n.lead.need ?? '-'}`,
      `Budget: ${n.lead.budget ?? '-'} | Timeline: ${n.lead.timeline ?? '-'}`,
      `Contact: ${n.lead.contact ?? '-'}`,
    );
  }
  if (n.link) lines.push(`Open: ${n.link}`);
  return lines.join('\n');
}

export const consoleNotifier: Notifier = {
  async send(n) {
    console.log('\n' + formatNotification(n) + '\n');
  },
};

export function telegramNotifier(botToken: string, chatId: string): Notifier {
  return {
    async send(n) {
      const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: formatNotification(n) }),
      });
      if (!res.ok) throw new Error(`Telegram sendMessage failed: ${res.status} ${await res.text()}`);
    },
  };
}

export function emailNotifier(to: string): Notifier {
  return {
    async send(n) {
      const subject = n.reason === 'new_lead' ? 'New lead from your AI assistant' : `Your AI assistant needs you (${n.reason})`;
      await sendEmail(to, subject, formatNotification(n));
    },
  };
}

export function notifierFor(cfg: NotifyConfig): Notifier {
  if (cfg.channel === 'telegram' && cfg.telegram?.botToken && cfg.telegram?.chatId) {
    return telegramNotifier(cfg.telegram.botToken, cfg.telegram.chatId);
  }
  if (cfg.channel === 'email' && cfg.email) return emailNotifier(cfg.email);
  return consoleNotifier;
}
