/** @module 책임: Git commit의 사람이 읽는 부분에 한국어 프로젝트 규칙을 강제한다. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HANGUL = /[가-힣]/;
const CONVENTIONAL_PREFIX =
  /^(?:build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(?:\([^)]+\))?!?:\s+/i;
const TRAILER = /^[A-Za-z][A-Za-z-]*:\s+\S+/;
const URL_ONLY = /^https?:\/\/\S+$/;

function contentLines(message) {
  return message
    .replaceAll("\r\n", "\n")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"));
}

/**
 * 커밋의 사람이 읽는 요약과 설명이 한국어 프로젝트 계약을 따르는지 검사한다.
 *
 * 요약은 반드시 한국어다. 설명은 문단 단위로 본다. 경로 나열이나 `(EAT-122, ADR 0014)` 같은 식별자
 * 줄은 한국어 문장 사이에 놓이는 것이 자연스러운데 줄마다 한글을 요구하면 그런 줄을 억지로 문장으로
 * 늘려야 한다. 설명이 있는데 한국어 문장이 한 줄도 없을 때만 거부한다.
 */
export function validateCommitMessage(message) {
  const lines = contentLines(message);
  const subjectIndex = lines.findIndex((line) => line.trim().length > 0);
  if (subjectIndex < 0) return { ok: false, errors: ["커밋 요약이 비어 있습니다."] };

  const subject = lines[subjectIndex].trim();
  const summary = subject.replace(CONVENTIONAL_PREFIX, "");
  const errors = [];
  if (!HANGUL.test(summary)) errors.push("커밋 요약은 한국어로 작성해야 합니다.");

  const body = lines.slice(subjectIndex + 1);
  let lastBodyLine = body.length - 1;
  while (lastBodyLine >= 0 && body[lastBodyLine].trim() === "") lastBodyLine -= 1;
  let trailerStart = lastBodyLine + 1;
  while (trailerStart > 0 && TRAILER.test(body[trailerStart - 1].trim())) trailerStart -= 1;

  let fenced = false;
  const prose = [];
  for (const [index, line] of body.entries()) {
    const text = line.trim();
    if (text.startsWith("```")) {
      fenced = !fenced;
      continue;
    }
    if (!text || fenced || (index >= trailerStart && TRAILER.test(text)) || URL_ONLY.test(text)) {
      continue;
    }
    prose.push(text);
  }
  if (prose.length > 0 && !prose.some((text) => HANGUL.test(text))) {
    errors.push(`커밋 설명에 한국어 문장이 없습니다: ${prose[0]}`);
  }
  return { ok: errors.length === 0, errors };
}

function main() {
  const messagePath = process.argv[2];
  if (!messagePath) throw new Error("커밋 메시지 파일 경로가 필요합니다.");
  const result = validateCommitMessage(readFileSync(path.resolve(messagePath), "utf8"));
  if (result.ok) return;
  for (const error of result.errors) console.error(`커밋 메시지 검사 실패: ${error}`);
  process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
