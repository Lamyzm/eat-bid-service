/** @module 책임: Web source 머리 주석의 `@boundary-waiver` 한 줄을 읽어 규칙·owner·이유·분리 조건을 검증하고, 그 finding만 면제하며 남은 waiver를 실패로 드러낸다. */
import { WEB_BOUNDARY_RULES } from "./policy.mjs";

export const WAIVER_TAG = "@boundary-waiver";
// waiver는 크기 규칙 하나에만 허용한다. 다른 규칙까지 열면 파일 안 주석이 새 ledger가 된다.
export const WAIVABLE_RULES = Object.freeze(new Set([WEB_BOUNDARY_RULES.SOURCE_FILE_SIZE]));
const REQUIRED_FIELDS = Object.freeze(["owner", "reason", "splitTrigger"]);
// owner는 추적 가능한 Linear issue 식별자여야 한다(AGENTS 20). 자유 문자열을 받으면 소유권이 없는 waiver가 남는다.
const ISSUE_OWNER = /^EAT-\d+$/u;
const hangul = /[가-힣]/u;
const waiverLine = /@boundary-waiver\s+([a-z-]+)((?:\s+\w+=(?:"[^"]*"|\S+))*)\s*(?:\*\/)?\s*$/u;
const field = /(\w+)=(?:"([^"]*)"|(\S+))/gu;
const directive = /^\s*['"][^'"]+['"]\s*;?\s*$/u;

/** 파일 머리는 shebang·빈 줄·주석·directive만 이어지는 구간이다. 첫 코드 줄에서 끝난다. */
function headerLines(source) {
  const lines = source.replace(/^\uFEFF/u, "").replaceAll("\r\n", "\n").split("\n");
  const header = [];
  let inBlock = false;
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    if (index === 0 && line.startsWith("#!")) continue;
    if (inBlock) {
      header.push({ line: index + 1, text: raw });
      if (line.includes("*/")) inBlock = false;
      continue;
    }
    if (line === "" || line.startsWith("//") || directive.test(line)) {
      header.push({ line: index + 1, text: raw });
      continue;
    }
    if (line.startsWith("/*")) {
      header.push({ line: index + 1, text: raw });
      inBlock = !line.includes("*/");
      continue;
    }
    return { header, rest: lines.slice(index) };
  }
  return { header, rest: [] };
}

function parseFields(text) {
  const values = {};
  for (const match of text.matchAll(field)) values[match[1]] = match[2] ?? match[3];
  return values;
}

/** 한 파일의 waiver 선언을 읽는다. 형식 오류는 waiver를 무시하지 않고 실패로 돌려준다. */
export function parseWaivers(source, displayPath) {
  const { header, rest } = headerLines(source);
  const waivers = [];
  const failures = [];
  if (rest.some((line) => line.includes(WAIVER_TAG))) {
    failures.push(`${displayPath}: ${WAIVER_TAG}는 import와 코드보다 앞선 파일 머리 주석에만 둘 수 있습니다.`);
  }
  for (const { line, text } of header) {
    if (!text.includes(WAIVER_TAG)) continue;
    const match = text.match(waiverLine);
    if (!match) {
      failures.push(`${displayPath}:${line} ${WAIVER_TAG} 형식은 '${WAIVER_TAG} <rule> owner=<issue> reason="…" splitTrigger="…"'입니다.`);
      continue;
    }
    const [, rule, fieldText] = match;
    const values = parseFields(fieldText);
    if (!WAIVABLE_RULES.has(rule)) {
      failures.push(`${displayPath}:${line} ${rule} 규칙은 waiver로 면제할 수 없습니다. 허용: ${[...WAIVABLE_RULES].join(", ")}`);
      continue;
    }
    const missing = REQUIRED_FIELDS.filter((name) => !values[name]?.trim());
    if (missing.length) {
      failures.push(`${displayPath}:${line} waiver에 ${missing.join(", ")}가 필요합니다.`);
      continue;
    }
    if (!ISSUE_OWNER.test(values.owner)) {
      failures.push(`${displayPath}:${line} waiver의 owner는 EAT-N 형식의 Linear issue 식별자여야 합니다.`);
      continue;
    }
    if (!hangul.test(values.reason) || !hangul.test(values.splitTrigger)) {
      failures.push(`${displayPath}:${line} waiver의 reason과 splitTrigger는 한국어 문장이어야 합니다.`);
      continue;
    }
    if (waivers.some((item) => item.rule === rule)) {
      failures.push(`${displayPath}:${line} ${rule} waiver가 중복됩니다.`);
      continue;
    }
    waivers.push({ rule, path: displayPath, line, owner: values.owner, reason: values.reason, splitTrigger: values.splitTrigger });
  }
  return { waivers, failures };
}

/**
 * waiver는 정확히 그 (rule, path) finding만 면제한다. 면제할 finding이 없는 waiver는 파일이 이미 규칙을
 * 만족한다는 뜻이므로 stale로 실패시킨다. 남겨 두면 다음 위반이 그 자리에 조용히 들어앉는다.
 */
export function applyWaivers({ findings, sources }) {
  const waived = [];
  const failures = [];
  const remaining = [...findings];
  for (const [displayPath, source] of sources) {
    const parsed = parseWaivers(source, displayPath);
    failures.push(...parsed.failures);
    for (const waiver of parsed.waivers) {
      const matched = remaining.filter((item) => item.rule === waiver.rule && item.path === displayPath);
      if (matched.length === 0) {
        failures.push(`${displayPath}:${waiver.line} stale waiver: ${waiver.rule} 위반이 더 이상 없으므로 waiver를 지우십시오.`);
        continue;
      }
      for (const item of matched) {
        remaining.splice(remaining.indexOf(item), 1);
        waived.push({ ...item, waiver });
      }
    }
  }
  return { findings: remaining, waived, failures };
}
