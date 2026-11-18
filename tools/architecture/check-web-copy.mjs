/**
 * @module 책임: 화면 글 검사(`pnpm copy:lint`) — 금지 말·질문형 문구 finding을 옛 위반 목록과 견줘 CLI 실패로 보고한다. 목록은 줄어들기만
 * 하고(ADR 0075 방식), 기준 commit보다 늘어난 열쇠는 손으로 늘린 것으로 본다.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CHANGED_BASE_ENV, resolveChangedBase } from "../git/changed-paths.mjs";
import { compareBaseline, grownKeys, parseBaseline, pruneBaseline } from "./web-boundaries/baseline.mjs";
import { inspectWebCopy } from "./web-copy/inspect.mjs";
import { COPY_BASELINE_PATH, COPY_RULES } from "./web-copy/policy.mjs";

const repoRoot = process.env.WEB_COPY_ROOT ? path.resolve(process.env.WEB_COPY_ROOT) : fileURLToPath(new URL("../../", import.meta.url));
const prune = process.argv.includes("--prune-baseline");
const RULES = new Set(Object.values(COPY_RULES));
const COMMENT = "화면 글 검사(copy:lint)의 옛 위반(#240). 줄어들기만 한다 — 손으로 늘리지 않는다. 고쳐서 사라지면 `pnpm copy:lint -- --prune-baseline`으로 지운다.";

function readText(file) {
  return existsSync(file) ? readFileSync(file, "utf8") : undefined;
}

function format(baseline) {
  const body = { $comment: COMMENT };
  for (const rule of [...RULES].sort()) body[rule] = [...(baseline.get(rule) ?? [])].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  return `${JSON.stringify(body, null, 2)}\n`;
}

function baselineAtBase() {
  let commit;
  try {
    commit = resolveChangedBase({ repoRoot, base: process.env[CHANGED_BASE_ENV] || undefined }).commit;
  } catch {
    return undefined;
  }
  try {
    return parseBaseline(execFileSync("git", ["show", `${commit}:${COPY_BASELINE_PATH}`], { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
  } catch {
    return undefined;
  }
}

const baselineFile = path.join(repoRoot, COPY_BASELINE_PATH);
let baseline = parseBaseline(readText(baselineFile));
const report = inspectWebCopy({ repoRoot, sourceRoot: "apps/web/src" });
const comparison = compareBaseline(report.findings, baseline, RULES);

if (prune) {
  baseline = pruneBaseline(baseline, comparison.stale);
  writeFileSync(baselineFile, format(baseline));
  console.log(`${COPY_BASELINE_PATH}에서 사라진 열쇠 ${comparison.stale.length}개를 지웠습니다.`);
}

const failures = [];
for (const item of comparison.fresh) failures.push(`${item.path}:${item.line} [${item.rule}] "${item.phrase}" — ${item.reason}`);
if (!prune) for (const item of comparison.stale) failures.push(`기준 목록의 ${item.rule} 열쇠 '${item.key}'는 더 이상 위반이 아닙니다. pnpm copy:lint -- --prune-baseline으로 지우십시오.`);
for (const item of comparison.foreign) failures.push(`${item.rule} 규칙은 화면 글 기준 목록에 올릴 수 없습니다('${item.key}').`);
for (const item of grownKeys(baseline, baselineAtBase())) failures.push(`기준 목록이 늘었습니다: ${item.rule} '${item.key}'. 새 위반은 목록에 싣지 않고 고칩니다.`);

if (failures.length) {
  console.error("화면 글 검사(copy:lint)가 실패했습니다:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`화면 글 검사가 통과했습니다. 살펴본 파일 ${report.fileCount}개, 옛 위반 목록 ${comparison.kept.length}개`);
}
