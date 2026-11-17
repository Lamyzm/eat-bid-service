/** @module 책임: Web module 경계 finding을 변경 범위·waiver·폴더 꼴 기준 목록과 함께 판정해 CLI 실패로 보고하고, 기준을 못 찾은 경우를 경고로 드러낸다. */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CHANGED_BASE_ENV, changedScope, describeScope, resolveChangedBase } from "../git/changed-paths.mjs";
import { BASELINE_PATH, grownKeys, pruneBaseline, readBaseline, readBaselineAt, writeBaseline } from "./web-boundaries/baseline.mjs";
import { inspectWebBoundaries } from "./web-boundaries/inspect.mjs";
import { CHANGE_SCOPED_RULES } from "./web-boundaries/policy.mjs";

const repoRoot = process.env.WEB_BOUNDARIES_ROOT
  ? path.resolve(process.env.WEB_BOUNDARIES_ROOT)
  : fileURLToPath(new URL("../../", import.meta.url));
const sourceRoot = path.join(repoRoot, "apps", "web", "src");
const prune = process.argv.includes("--prune-baseline");
const argv = process.argv.slice(2).filter((item) => item !== "--prune-baseline");

const scope = changedScope({ repoRoot, argv });
// 기준이 없으면 어떤 legacy 파일이 "수정된" 것인지 말할 수 없다. 그 규칙만 판정을 보류하고 경고로 알린다.
// 예외 없는 규칙은 기준과 무관하므로 그대로 판정한다.
const changedPaths = scope.mode === "all" ? undefined : scope.mode === "changed" ? scope.paths : new Set();
const baseline = readBaseline(repoRoot);
const report = await inspectWebBoundaries({ repoRoot, sourceRoot, changedPaths, baseline });

if (prune) {
  // 지우기만 한다. 새 위반을 목록에 더하는 길은 두지 않는다(ADR 0075).
  writeBaseline(repoRoot, pruneBaseline(baseline, report.stale));
  console.log(`${BASELINE_PATH}에서 사라진 열쇠 ${report.stale.length}개를 지웠습니다.`);
  report.failures = report.failures.filter((failure) => !failure.startsWith("기준 목록의 "));
}

// 목록은 줄어들기만 한다. 기준 commit의 목록에 없던 열쇠는 손으로 늘린 것이다. 기준 commit에 목록이 없으면 첫 목록이다.
const grown = grownKeys(baseline, readBaselineAt(repoRoot, growthBaseCommit()));
for (const item of grown) report.failures.push(`기준 목록이 늘었습니다: ${item.rule} '${item.key}'. 새 위반은 목록에 싣지 않고 고칩니다(ADR 0075).`);

if (scope.mode === "unresolved") {
  console.warn(`경고: ${scope.reason}`);
  console.warn(
    `변경 범위 규칙(${[...CHANGE_SCOPED_RULES].join(", ")})은 판정하지 않았습니다. --base <ref>로 기준을 지정하십시오.`,
  );
}
if (report.findings.length || report.failures.length) {
  console.error(`Web boundary check failed (${describeScope(scope)}):`);
  for (const item of report.findings) console.error(`- ${item.path} [${item.rule}] ${item.reason}`);
  for (const failure of report.failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    `Web boundary check passed. ${describeScope(scope)}, 변경 범위 밖 legacy finding ${report.skipped.length}개 생략, waiver ${report.waived.length}개, 폴더 꼴 기준 목록 ${report.baselined.length}개`,
  );
}

function growthBaseCommit() {
  if (scope.mode === "changed" && scope.base?.commit) return scope.base.commit;
  try {
    return resolveChangedBase({ repoRoot, base: process.env[CHANGED_BASE_ENV] || undefined }).commit;
  } catch {
    return resolveChangedBase({ repoRoot }).commit;
  }
}
