// @module 책임: Stop 훅: 사용자에게 보이는 마지막 답이 한국어인지 본다(AGENTS 21, 판정은 tools/agent-hooks/korean-reply.mjs).
// 막은 뒤 다시 멈출 때(stop_hook_active)는 두 번 막지 않는다 — 끝없는 고리를 막는다.
import { readFileSync } from 'node:fs';
import { englishReplyReason, lastAssistantText } from '../../tools/agent-hooks/korean-reply.mjs';

let input = {};
try {
  input = JSON.parse(readFileSync(0, 'utf8') || '{}');
} catch {
  process.exit(0);
}
if (input.stop_hook_active) process.exit(0);
const reason = englishReplyReason(lastAssistantText(input));
if (reason) process.stdout.write(JSON.stringify({ decision: 'block', reason }));
process.exit(0);
