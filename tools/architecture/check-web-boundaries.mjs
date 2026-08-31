import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectWebBoundaries } from "./web-boundaries/inspect.mjs";
import { reviewedBaselineMetadata } from "./web-boundaries/policy.mjs";

const repoRoot = process.env.WEB_BOUNDARIES_ROOT
  ? path.resolve(process.env.WEB_BOUNDARIES_ROOT)
  : fileURLToPath(new URL("../../", import.meta.url));
const sourceRoot = path.join(repoRoot, "apps", "web", "src");
const baselinePath = process.env.WEB_BOUNDARIES_BASELINE
  ? path.resolve(process.env.WEB_BOUNDARIES_BASELINE)
  : path.join(repoRoot, "tools", "architecture", "web-boundary-legacy-baseline.json");
const writeBaseline = process.argv.slice(2).includes("--write-baseline");

if (writeBaseline && existsSync(baselinePath)) {
  console.error(`Refuses to overwrite existing baseline: ${baselinePath}`);
  process.exitCode = 1;
} else {
  const report = await inspectWebBoundaries({ repoRoot, sourceRoot, baselinePath });
  if (writeBaseline) {
    const document = { version: 1, entries: report.findings.map((item) => {
      const [reason, splitTrigger] = reviewedBaselineMetadata(item);
      return { rule: item.rule, path: item.path, kind: item.kind, sha256: item.sha256, reason, owner: "EAT-9 frontend foundation", splitTrigger, ...(item.members ? { members: item.members } : {}), ...(item.contentSha256 ? { contentSha256: item.contentSha256 } : {}) };
    }) };
    writeFileSync(baselinePath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    console.log(`Wrote ${document.entries.length} reviewed Web boundary baseline entries.`);
  } else if (report.unmatchedFindings.length || report.baselineFailures.length) {
    console.error("Web boundary check failed:");
    for (const item of report.unmatchedFindings) console.error(`- ${item.path} [${item.rule}] ${item.reason}`);
    for (const failure of report.baselineFailures) console.error(`- ${failure}`);
    process.exitCode = 1;
  } else {
    console.log("Web boundary check passed.");
  }
}
