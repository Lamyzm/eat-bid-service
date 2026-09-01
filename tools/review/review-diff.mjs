/** @module 책임: unified diff를 파일 단위로 나누고 credential·binary hunk를 제외해 리뷰 prompt의 변경 diff section을 만든다. */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { hasSensitiveContent } from "./sensitive-content.mjs";

const HEADER = /^diff --git a\/(.+?) b\/(.+)$/;
const BINARY = /^(?:GIT binary patch|Binary files .* differ)$/m;

export function splitPatchByFile(patch) {
  const chunks = [];
  let current = null;
  for (const line of patch.replaceAll("\r\n", "\n").split("\n")) {
    const header = line.match(HEADER);
    if (header) {
      if (current) chunks.push(current);
      current = { path: header[2].replaceAll("\\", "/"), lines: [line] };
      continue;
    }
    if (current) current.lines.push(line);
  }
  if (current) chunks.push(current);
  return chunks.map((chunk) => ({
    path: chunk.path,
    text: `${chunk.lines.join("\n").replace(/\n+$/u, "")}\n`,
  }));
}

/** diff 안의 ``` 줄이 fence를 조기에 닫지 않도록 본문의 최장 backtick 연속보다 긴 fence를 쓴다. */
function fenceFor(text) {
  const longest = Math.max(3, ...[...text.matchAll(/`{3,}/gu)].map((match) => match[0].length));
  return "`".repeat(longest + 1);
}

/**
 * denied-path preflight는 경로 이름만 본다. 여기서는 hunk 본문과 현재 파일 본문을 함께 검사해
 * 이름이 평범한 파일에 들어간 credential이 prompt로 새지 않게 한다. 값은 절대 출력하지 않는다.
 */
function exclusionReason(repoRoot, chunk) {
  if (BINARY.test(chunk.text)) return "binary";
  if (hasSensitiveContent(chunk.text, chunk.path)) return "sensitive-content";
  const target = path.join(repoRoot, chunk.path);
  if (existsSync(target) && hasSensitiveContent(readFileSync(target, "utf8"), chunk.path)) {
    return "sensitive-content";
  }
  return null;
}

export function renderDiffSection({ repoRoot, patch }) {
  if (typeof patch !== "string" || patch.trim().length === 0) {
    return "## 변경 diff\n\n```text\n(diff 없음: scope에 patch가 전달되지 않았다.)\n```";
  }
  const included = [];
  const excluded = [];
  for (const chunk of splitPatchByFile(patch)) {
    const reason = exclusionReason(path.resolve(repoRoot), chunk);
    if (reason) excluded.push(`- ${chunk.path} (${reason})`);
    else included.push(chunk.text);
  }
  const body = included.join("");
  const fence = fenceFor(body);
  const exclusionNote = excluded.length > 0 ? `제외한 파일:\n${excluded.join("\n")}\n\n` : "";
  return `## 변경 diff\n\n${exclusionNote}${fence}diff\n${body}${fence}`;
}
