/** @module 책임: 결정 어휘 금지 finding을 예외 없이 CLI 실패로 보고한다. */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectDecisionVocabulary } from "./decision-vocabulary/inspect.mjs";

const repoRoot = process.env.DECISION_VOCABULARY_ROOT
  ? path.resolve(process.env.DECISION_VOCABULARY_ROOT)
  : fileURLToPath(new URL("../../", import.meta.url));

// 화면 문자열은 web에만 있다. 서버·계약의 문구는 화면에 그대로 나오지 않으므로 여기서 보지 않는다.
const SOURCE_ROOTS = ["apps/web/src"];

const report = inspectDecisionVocabulary({ repoRoot, sourceRoots: SOURCE_ROOTS });

if (report.findings.length) {
  console.error("결정 어휘 검사가 실패했습니다:");
  for (const item of report.findings) console.error(`- ${item.path}:${item.line} [${item.rule}] "${item.phrase}" — ${item.reason}`);
  process.exitCode = 1;
} else {
  console.log(`결정 어휘 검사가 통과했습니다. 살펴본 파일 ${report.fileCount}개`);
}
