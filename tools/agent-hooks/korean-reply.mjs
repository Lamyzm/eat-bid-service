/**
 * @module 책임: 사용자에게 보이는 마지막 답이 한국어인지 판정한다(AGENTS 21 — 진행 보고는 한국어).
 *
 * 코드 블록·인라인 코드·URL·경로는 영문이 섞이는 게 정상이라 빼고 센다. 남은 글에서 영문 글자가 80자 이상이고 한글보다
 * 많을 때만 다시 쓰게 한다 — 짧은 영문 낱말이 섞인 한국어 답은 지나간다. 온누리 hook(2026-11-04)과 같은 기준이다.
 */
import { readFileSync } from 'node:fs';

/** 이번 턴의 마지막 어시스턴트 글이다. 사용자의 진짜 말(도구 결과가 아닌) 뒤의 마지막 텍스트 묶음만 모은다. */
export function lastAssistantText(input) {
  if (typeof input.last_assistant_message === 'string') return input.last_assistant_message;
  if (!input.transcript_path) return '';
  let lines;
  try {
    lines = readFileSync(input.transcript_path, 'utf8').trim().split('\n');
  } catch {
    return '';
  }
  const texts = [];
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    let entry;
    try {
      entry = JSON.parse(lines[index]);
    } catch {
      continue;
    }
    const role = entry.message?.role ?? entry.type;
    const content = entry.message?.content;
    if (role === 'user') {
      const isToolResult = Array.isArray(content) && content.some((part) => part?.type === 'tool_result');
      if (!isToolResult && !entry.isMeta) break;
      continue;
    }
    if (role === 'assistant' && Array.isArray(content)) {
      for (let part = content.length - 1; part >= 0; part -= 1) {
        if (content[part]?.type === 'text') texts.unshift(content[part].text);
      }
      if (texts.length > 0 && content.some((part) => part?.type === 'tool_use')) break;
    }
  }
  return texts.join('\n');
}

export function prose(text) {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[A-Za-z]:[\\/][^\s)]*/g, ' ')
    .replace(/(?:\.{0,2}\/)?[\w.-]+(?:\/[\w.@-]+)+/g, ' ');
}

/** 다시 쓰게 할 까닭을 돌려준다. 지나가면 null이다. */
export function englishReplyReason(text) {
  const body = prose(text);
  const hangul = (body.match(/[가-힣]/g) ?? []).length;
  const latin = (body.match(/[A-Za-z]/g) ?? []).length;
  if (latin >= 80 && latin > hangul) {
    return `방금 답이 한국어가 아니에요(영문 ${latin}자, 한글 ${hangul}자). 사용자에게 보이는 답은 늘 한국어로 써요 — 같은 내용을 한국어로 다시 쓰세요. 코드 이름·명령·경로만 원문으로 둬요.`;
  }
  return null;
}
