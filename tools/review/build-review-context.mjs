import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectWebBoundaries } from "../architecture/web-boundaries/inspect.mjs";
import { buildReuseCatalog } from "./reuse-catalog.mjs";

export const MAX_REVIEW_CONTEXT_BYTES = 96 * 1024;
const moduleRoot = path.dirname(fileURLToPath(import.meta.url));
const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;

function normalizedPaths(paths = []) {
  return [...new Set(paths.map((item) => String(item).replaceAll("\\", "/").replace(/^\.\//, "")))].sort(compare);
}

function countByRule(findings) {
  const counts = new Map();
  for (const finding of findings) counts.set(finding.rule, (counts.get(finding.rule) ?? 0) + 1);
  return Object.fromEntries([...counts].sort(([left], [right]) => compare(left, right)));
}

async function boundaryEvidence(root, changedPaths) {
  const sourceRoot = path.join(root, "apps", "web", "src");
  if (!existsSync(sourceRoot)) return { findingCounts: {}, scopedFindings: [], unmatchedFindingCount: 0, baselineFailures: [] };
  const report = await inspectWebBoundaries({
    repoRoot: root,
    sourceRoot,
    baselinePath: path.join(root, "tools", "architecture", "web-boundary-legacy-baseline.json"),
  });
  const changed = new Set(changedPaths);
  const scopedFindings = report.findings
    .filter((finding) => changed.has(finding.path) || finding.members?.some((member) => changed.has(member)))
    .map((finding) => ({ rule: finding.rule, path: finding.path, kind: finding.kind, ...(finding.members ? { members: finding.members } : {}) }));
  return { findingCounts: countByRule(report.findings), scopedFindings, unmatchedFindingCount: report.unmatchedFindings.length, baselineFailures: report.baselineFailures };
}

function boundedUtf8(contents) {
  const buffer = Buffer.from(contents, "utf8");
  if (buffer.length <= MAX_REVIEW_CONTEXT_BYTES) return contents;
  const suffix = "\n\n[review context truncated deterministically at 96 KiB]\n";
  const suffixBytes = Buffer.byteLength(suffix, "utf8");
  let end = MAX_REVIEW_CONTEXT_BYTES - suffixBytes;
  while (end > 0 && (buffer[end] & 0xc0) === 0x80) end -= 1;
  return `${buffer.subarray(0, end).toString("utf8")}${suffix}`;
}

export async function buildReviewContext({ repoRoot, scope = {} }) {
  const root = path.resolve(repoRoot);
  const changedPaths = normalizedPaths(scope.changedPaths);
  const [catalog, boundaries] = await Promise.all([
    buildReuseCatalog({ repoRoot: root, changedPaths, perFileByteCap: 12 * 1024, totalSourceByteCap: 32 * 1024, esToolkitDeclarationByteCap: 16 * 1024 }),
    boundaryEvidence(root, changedPaths),
  ]);
  const instructions = readFileSync(path.join(moduleRoot, "reviewer-instructions.md"), "utf8").trim();
  const rules = JSON.parse(readFileSync(path.join(moduleRoot, "catalog", "frontend-advisory-rules.json"), "utf8"));
  const metadata = { version: "eatbid.frontend-review-context/v1", baseRef: scope.baseRef ?? null, changedPaths };
  const sections = [
    "# eatbid frontend advisory review context",
    `## Scope\n\n\`\`\`json\n${JSON.stringify(metadata, null, 2)}\n\`\`\``,
    `## Reviewer contract\n\n${instructions}`,
    `## Repository reuse evidence\n\n\`\`\`json\n${JSON.stringify(catalog, null, 2)}\n\`\`\``,
    `## Deterministic boundary evidence\n\nThese diagnostics remain authoritative and must not be repeated as advisory findings.\n\n\`\`\`json\n${JSON.stringify(boundaries, null, 2)}\n\`\`\``,
    `## Curated advisory rules\n\n\`\`\`json\n${JSON.stringify(rules, null, 2)}\n\`\`\``,
  ];
  return boundedUtf8(`${sections.join("\n\n")}\n`);
}

function changedPathsFromGit(root, baseRef) {
  const output = execFileSync("git", ["diff", "--name-only", "--diff-filter=ACMR", "-z", `${baseRef}...HEAD`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return normalizedPaths(output.split("\0").filter(Boolean));
}

async function main() {
  const args = process.argv.slice(2);
  const baseIndex = args.indexOf("--base");
  const baseRef = baseIndex >= 0 ? args[baseIndex + 1] : "HEAD~1";
  if (!baseRef || baseRef.startsWith("--")) throw new Error("--base requires a Git ref");
  const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
  const context = await buildReviewContext({ repoRoot, scope: { baseRef, changedPaths: changedPathsFromGit(repoRoot, baseRef) } });
  if (args.includes("--check")) console.log(`Review context check passed (${Buffer.byteLength(context, "utf8")} bytes).`);
  else process.stdout.write(context);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => {
  console.error(`Review context build failed: ${error.message}`);
  process.exitCode = 1;
});
