// Transactional email via Resend's HTTP API (no SDK needed). Without an API key the message
// is logged so local development never sends mail by accident.
import { config } from '../config.js';

export async function sendEmail(to: string, subject: string, text: string): Promise<void> {
  if (!config.resendApiKey) {
    console.log(`[email:not-sent] to=${to} subject=${subject}\n${text}\n`);
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${config.resendApiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: config.emailFrom, to: [to], subject, text }),
  });
  if (!res.ok) throw new Error(`Resend failed: ${res.status} ${await res.text()}`);
}
