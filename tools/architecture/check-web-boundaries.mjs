/** @module 책임: Web module 경계 finding을 변경 범위·waiver와 함께 판정해 CLI 실패로 보고하고, 기준을 못 찾은 경우를 경고로 드러낸다. */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { changedScope, describeScope } from "../git/changed-paths.mjs";
import { inspectWebBoundaries } from "./web-boundaries/inspect.mjs";
import { CHANGE_SCOPED_RULES } from "./web-boundaries/policy.mjs";

const repoRoot = process.env.WEB_BOUNDARIES_ROOT
  ? path.resolve(process.env.WEB_BOUNDARIES_ROOT)
  : fileURLToPath(new URL("../../", import.meta.url));
const sourceRoot = path.join(repoRoot, "apps", "web", "src");

const scope = changedScope({ repoRoot });
// 기준이 없으면 어떤 legacy 파일이 "수정된" 것인지 말할 수 없다. 그 규칙만 판정을 보류하고 경고로 알린다.
// 예외 없는 규칙은 기준과 무관하므로 그대로 판정한다.
const changedPaths = scope.mode === "all" ? undefined : scope.mode === "changed" ? scope.paths : new Set();
const report = await inspectWebBoundaries({ repoRoot, sourceRoot, changedPaths });

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
    `Web boundary check passed. ${describeScope(scope)}, 변경 범위 밖 legacy finding ${report.skipped.length}개 생략, waiver ${report.waived.length}개`,
  );
}
