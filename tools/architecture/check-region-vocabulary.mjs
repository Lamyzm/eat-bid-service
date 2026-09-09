/** @module 책임: 지역 어휘 재선언 finding을 삭제 전용 ledger와 대조하고 CLI 실패로 보고한다. */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectRegionVocabulary } from "./region-vocabulary/inspect.mjs";

const repoRoot = process.env.REGION_VOCABULARY_ROOT
  ? path.resolve(process.env.REGION_VOCABULARY_ROOT)
  : fileURLToPath(new URL("../../", import.meta.url));

// 어휘를 소비하는 TypeScript 층 전부를 본다. Python 쪽은 새 도구를 만들지 않고
// `apps/dataplane/tests/unit/test_code_schemes.py`가 같은 단일 선언을 고정한다(AGENTS 22).
const SOURCE_ROOTS = ["apps/web/src", "apps/server/src", "packages/contracts/src", "packages/db/src"];

const baselinePath = process.env.REGION_VOCABULARY_BASELINE
  ? path.resolve(process.env.REGION_VOCABULARY_BASELINE)
  : path.join(repoRoot, "tools", "architecture", "region-vocabulary-legacy-baseline.json");

const report = inspectRegionVocabulary({ repoRoot, sourceRoots: SOURCE_ROOTS, baselinePath });

if (report.unmatchedFindings.length || report.baselineFailures.length) {
  console.error("지역 어휘 재선언 검사가 실패했습니다:");
  for (const item of report.unmatchedFindings) console.error(`- ${item.path} [${item.rule}] ${item.reason}`);
  for (const failure of report.baselineFailures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`지역 어휘 재선언 검사가 통과했습니다. 선언된 코드 체계 ${report.schemes.length}개`);
}
