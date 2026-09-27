// Interactive terminal chat for local testing. Usage: npm run cli
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { randomUUID } from 'node:crypto';
import { chatTurn, getOrCreateConversation } from './services/chat.js';

const tenantId = process.argv[2] ?? 'default';
const conversation = await getOrCreateConversation(tenantId, undefined, `cli-${randomUUID().slice(0, 8)}`);
const rl = createInterface({ input: stdin, output: stdout });

console.log(`Conversation ${conversation.id} (tenant: ${tenantId}). Type "exit" to quit.\n`);

while (true) {
  const line = (await rl.question('you> ')).trim();
  if (!line) continue;
  if (line === 'exit') break;

  stdout.write('bot> ');
  for await (const ev of chatTurn(tenantId, conversation.id, line)) {
    if (ev.type === 'token') stdout.write(ev.data);
    else if (ev.type === 'tool') stdout.write(`\n[tool: ${ev.data}]\n`);
    else if (ev.type === 'reset') stdout.write(`\n[rewriting reply]\n`);
    else if (ev.type === 'error') stdout.write(`\n[error] ${ev.data}`);
  }
  stdout.write('\n\n');
}
rl.close();
