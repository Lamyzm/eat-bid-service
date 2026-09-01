/** @module 책임: unified diff를 파일 단위로 나누고 denied 경로·credential·binary hunk를 제외해 리뷰 prompt의 변경 diff section을 만든다. */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { DENIED_PATH } from "./git-scope.mjs";
import { hasSensitiveContent } from "./sensitive-content.mjs";

const HEADER = /^diff --git a\/(.+?) b\/(.+)$/;
// git은 a/와 b/를 각각 quote하므로 한쪽만 quote된 header도 나온다. HEADER에 맞지 않는 `diff --git` 줄은
// 모두 경로를 확정할 수 없는 chunk로 시작해 앞 chunk에 본문이 합쳐지지 않게 한다.
const ANY_HEADER = /^diff --git /;
const BINARY = /^(?:GIT binary patch|Binary files .* differ)$/m;
// AST 검사는 둘러싼 `{`가 hunk context 안에 있어야 owner 이름을 본다. context 밖 깊은 속성의
// credential 줄은 값 모양과 무관하게 보수적으로 잡는다. 값은 출력하지 않으므로 오탐 비용은 hunk 하나다.
// JS/TS에서는 `password: string;` 같은 타입 선언 오탐을 피하려고 따옴표로 시작하는 값만 잡고,
// YAML·TOML·properties·ini처럼 따옴표 없는 값이 일반적인 확장자에서는 어떤 값이든 잡는다.
const CREDENTIAL_KEY =
  /^\s*["']?[\w.-]*(?:password|api[_-]?key|api[_-]?token|access[_-]?token|refresh[_-]?token|client[_-]?secret|authorization)["']?\s*[:=]\s*/i;
const LINE_CREDENTIAL = new RegExp(`${CREDENTIAL_KEY.source}["'\`]`, "i");
// YAML·ini에서는 주석 처리한 평문 비밀번호도 흔하므로 `#`·`;` 접두 줄까지 잡는다.
const LINE_CREDENTIAL_UNQUOTED = new RegExp(`^\\s*(?:[#;]\\s*)?${CREDENTIAL_KEY.source.slice(1)}\\S`, "i");
const UNQUOTED_VALUE_EXTENSION = /\.(?:ya?ml|toml|properties|ini|cfg|conf)$/i;
const DELETED_NOTE =
  "삭제된 파일의 hunk는 근거일 뿐 finding 대상이 아니다. finding 경로는 `검토 범위`의 changedPaths 안에서만 고른다.";

export function splitPatchByFile(patch) {
  const chunks = [];
  let current = null;
  for (const line of patch.replaceAll("\r\n", "\n").split("\n")) {
    const header = line.match(HEADER);
    const quoted = !header && ANY_HEADER.test(line);
    if (header || quoted) {
      if (current) chunks.push(current);
      current = {
        path: header ? header[2].replaceAll("\\", "/") : line.slice("diff --git ".length),
        oldPath: header ? header[1].replaceAll("\\", "/") : null,
        quoted,
        lines: [line],
      };
      continue;
    }
    if (current) current.lines.push(line);
  }
  if (current) chunks.push(current);
  return chunks.map((chunk) => ({
    path: chunk.path,
    oldPath: chunk.oldPath,
    quoted: chunk.quoted,
    text: `${chunk.lines.join("\n").replace(/\n+$/u, "")}\n`,
  }));
}

/**
 * hunk 접두어(+, -, 공백)가 붙은 텍스트는 TS parser가 선언·속성으로 읽지 못해 owner 이름 기반 credential
 * 검사가 빠진다. old side와 new side를 각각 원래 source 모양으로 복원해 검사한다.
 */
export function hunkSides(text) {
  const old = [];
  const next = [];
  let inHunk = false;
  for (const line of text.replaceAll("\r\n", "\n").split("\n")) {
    if (line.startsWith("@@")) {
      inHunk = true;
      continue;
    }
    if (!inHunk || line.startsWith("\\")) continue;
    if (line.startsWith("-")) old.push(line.slice(1));
    else if (line.startsWith("+")) next.push(line.slice(1));
    else if (line.startsWith(" ")) {
      old.push(line.slice(1));
      next.push(line.slice(1));
    }
  }
  return [old.join("\n"), next.join("\n")];
}

/** diff 안의 ``` 줄이 fence를 조기에 닫지 않도록 본문의 최장 backtick 연속보다 긴 fence를 쓴다. */
function fenceFor(text) {
  const longest = Math.max(3, ...[...text.matchAll(/`{3,}/gu)].map((match) => match[0].length));
  return "`".repeat(longest + 1);
}

function changedLinesLookSensitive(chunk) {
  const pattern = UNQUOTED_VALUE_EXTENSION.test(chunk.path) ? LINE_CREDENTIAL_UNQUOTED : LINE_CREDENTIAL;
  return hunkSides(chunk.text).some((side) => side.split("\n").some((line) => pattern.test(line)));
}

/**
 * preflight는 경로 이름으로 거부하지만 여기서 한 번 더 막아 preflight를 거치지 않은 patch도 안전하게 한다.
 * rename은 old 경로 본문이 `-` 줄로 남으므로 old·new 경로를 모두 검사하고, quote된 header는 경로를 확정할 수
 * 없어 fail-closed로 제외한다. 그 다음 old/new side 본문과 현재 파일 본문을 검사한다. 값은 절대 출력하지 않는다.
 */
function exclusionReason(repoRoot, chunk) {
  if (chunk.quoted) return "quoted-path";
  if (DENIED_PATH.test(chunk.path) || (chunk.oldPath && DENIED_PATH.test(chunk.oldPath))) return "denied-path";
  if (BINARY.test(chunk.text)) return "binary";
  if (hunkSides(chunk.text).some((side) => hasSensitiveContent(side, chunk.path))) {
    return "sensitive-content";
  }
  if (changedLinesLookSensitive(chunk)) return "sensitive-content";
  const target = path.join(repoRoot, chunk.path);
  if (existsSync(target) && hasSensitiveContent(readFileSync(target, "utf8"), chunk.path)) {
    return "sensitive-content";
  }
  return null;
}

function chunkLabel(chunk) {
  if (chunk.quoted) return "(quote된 경로)";
  return chunk.oldPath && chunk.oldPath !== chunk.path ? `${chunk.oldPath} → ${chunk.path}` : chunk.path;
}

export function renderDiffSection({ repoRoot, patch }) {
  if (typeof patch !== "string" || patch.trim().length === 0) {
    return "## 변경 diff\n\n```text\n(diff 없음: scope에 patch가 전달되지 않았다.)\n```";
  }
  const included = [];
  const excluded = [];
  for (const chunk of splitPatchByFile(patch)) {
    const reason = exclusionReason(path.resolve(repoRoot), chunk);
    if (reason) excluded.push(`- ${chunkLabel(chunk)} (${reason})`);
    else included.push(chunk.text);
  }
  const body = included.join("");
  const fence = fenceFor(body);
  const exclusionNote = excluded.length > 0 ? `제외한 파일:\n${excluded.join("\n")}\n\n` : "";
  return `## 변경 diff\n\n${DELETED_NOTE}\n\n${exclusionNote}${fence}diff\n${body}${fence}`;
}
