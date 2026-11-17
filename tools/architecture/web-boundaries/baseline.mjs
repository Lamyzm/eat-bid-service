/**
 * @module 책임: 폴더 꼴·import 그래프 규칙의 옛 위반을 규칙별 열쇠로 기억하는 기준 목록을 읽고 쓰며, 새 위반·사라진 열쇠·기준 commit 대비 늘어난
 * 열쇠를 가려 목록이 줄어들기만 하게 한다(ADR 0075).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const BASELINE_PATH = "tools/architecture/web-boundaries/folder-baseline.json";
const COMMENT = "Web 폴더 꼴·import 그래프의 옛 위반(ADR 0075). 줄어들기만 한다 — 손으로 늘리지 않는다. 고쳐서 위반이 사라지면 `pnpm lint:web-boundaries -- --prune-baseline`으로 지운다.";

/** JSON 글을 규칙 → 열쇠 집합으로 읽는다. `$`로 시작하는 칸은 설명이다. 글이 없으면 빈 목록이다. */
export function parseBaseline(text) {
  if (!text) return new Map();
  const data = JSON.parse(text);
  return new Map(Object.entries(data).filter(([rule]) => !rule.startsWith("$")).map(([rule, keys]) => [rule, new Set(keys)]));
}

export function readBaseline(repoRoot) {
  const file = path.join(repoRoot, BASELINE_PATH);
  return existsSync(file) ? parseBaseline(readFileSync(file, "utf8")) : new Map();
}

/** 규칙 이름 차례, 열쇠 code point 차례로 적는다. 다시 써도 diff가 흔들리지 않는다. */
export function formatBaseline(baseline) {
  const body = { $comment: COMMENT };
  for (const rule of [...baseline.keys()].sort()) {
    const keys = [...baseline.get(rule)].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
    if (keys.length) body[rule] = keys;
  }
  return `${JSON.stringify(body, null, 2)}\n`;
}

export function writeBaseline(repoRoot, baseline) {
  writeFileSync(path.join(repoRoot, BASELINE_PATH), formatBaseline(baseline));
}

/**
 * 기준 목록을 두는 규칙의 finding을 목록과 견준다.
 * - `kept`: 목록에 있는 옛 위반(보고하지 않고 수만 센다)
 * - `fresh`: 목록에 없는 위반(실패)
 * - `stale`: 목록에 있는데 더는 위반이 아닌 열쇠(실패 — 지워야 목록이 준다)
 * - `foreign`: 기준 목록에 올릴 수 없는 규칙의 열쇠(실패)
 */
export function compareBaseline(findings, baseline, baselinedRules) {
  const seen = new Map();
  const kept = [];
  const fresh = [];
  for (const finding of findings) {
    if (!seen.has(finding.rule)) seen.set(finding.rule, new Set());
    seen.get(finding.rule).add(finding.key);
    if (baseline.get(finding.rule)?.has(finding.key)) kept.push(finding);
    else fresh.push(finding);
  }
  const stale = [];
  const foreign = [];
  for (const [rule, keys] of baseline) {
    if (!baselinedRules.has(rule)) {
      for (const key of keys) foreign.push({ rule, key });
      continue;
    }
    for (const key of keys) if (!seen.get(rule)?.has(key)) stale.push({ rule, key });
  }
  return { kept, fresh, stale, foreign };
}

/** 기준 commit의 목록에 없던 열쇠(손으로 늘린 것). 기준 commit에 목록이 없으면 첫 목록이라 늘어난 것으로 보지 않는다. */
export function grownKeys(baseline, before) {
  if (!before) return [];
  const grown = [];
  for (const [rule, keys] of baseline) for (const key of keys) if (!before.get(rule)?.has(key)) grown.push({ rule, key });
  return grown;
}

/** 목록에서 더는 위반이 아닌 열쇠만 뺀다. 새 위반은 더하지 않는다. */
export function pruneBaseline(baseline, stale) {
  const drop = new Set(stale.map((item) => `${item.rule}\u0000${item.key}`));
  return new Map([...baseline].map(([rule, keys]) => [rule, new Set([...keys].filter((key) => !drop.has(`${rule}\u0000${key}`)))]));
}

/** 기준 commit의 목록. git이 그 commit에서 파일을 못 찾으면 undefined(첫 목록). */
export function readBaselineAt(repoRoot, commit) {
  if (!commit) return undefined;
  try {
    const text = execFileSync("git", ["show", `${commit}:${BASELINE_PATH}`], { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return parseBaseline(text);
  } catch {
    return undefined;
  }
}
