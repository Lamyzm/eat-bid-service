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

function renderSection(heading, value) {
  return `## ${heading}\n\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}

function renderContext({ metadata, instructions, catalog, boundaries, rules }) {
  return `${[
    "# eatbid frontend advisory review context",
    renderSection("Scope", metadata),
    `## Reviewer contract\n\n${instructions}`,
    renderSection("Repository reuse evidence", catalog),
    `## Deterministic boundary evidence\n\nThese diagnostics remain authoritative and must not be repeated as advisory findings.\n\n\`\`\`json\n${JSON.stringify(boundaries, null, 2)}\n\`\`\``,
    renderSection("Curated advisory rules", rules),
  ].join("\n\n")}\n`;
}

function withoutSource(module) {
  const { source: _source, ...metadata } = module;
  return metadata;
}

function budgetCatalog(catalog, render) {
  if (Buffer.byteLength(render(catalog), "utf8") <= MAX_REVIEW_CONTEXT_BYTES) return catalog;
  const originalModules = catalog.modules;
  const originalSourceCount = originalModules.filter((module) => module.source !== undefined).length;
  const { declaration: _declaration, ...toolkitMetadata } = catalog.esToolkit;
  if (_declaration !== undefined) toolkitMetadata.declarationExcludedReason = "context-byte-budget";
  let includedCount = originalModules.length;
  let includedExclusions = catalog.exclusions.length;
  const includedSources = new Set();

  const candidate = () => {
    const modules = originalModules.slice(0, includedCount).map((module, index) => includedSources.has(index) ? module : withoutSource(module));
    const modulePaths = new Set(modules.map((module) => module.path));
    const duplicateGroups = catalog.duplicateGroups.filter((group) => group.members.every((member) => modulePaths.has(member)));
    return {
      ...catalog,
      modules,
      duplicateGroups,
      esToolkit: toolkitMetadata,
      exclusions: catalog.exclusions.slice(0, includedExclusions),
      contextBudget: {
        reason: "context-byte-budget",
        originalModuleCount: originalModules.length,
        includedModuleCount: modules.length,
        omittedModuleCount: originalModules.length - modules.length,
        omittedSourceCount: originalSourceCount - [...includedSources].filter((index) => index < includedCount).length,
        omittedDuplicateGroupCount: catalog.duplicateGroups.length - duplicateGroups.length,
        omittedExclusionCount: catalog.exclusions.length - includedExclusions,
        esToolkitDeclarationOmitted: _declaration !== undefined,
        ...(includedCount < originalModules.length ? {
          firstOmittedModulePath: originalModules[includedCount].path,
          lastOmittedModulePath: originalModules.at(-1).path,
        } : {}),
        ...(includedExclusions < catalog.exclusions.length ? {
          firstOmittedExclusionPath: catalog.exclusions[includedExclusions].path,
          lastOmittedExclusionPath: catalog.exclusions.at(-1).path,
        } : {}),
      },
    };
  };

  while (includedCount > 0 && Buffer.byteLength(render(candidate()), "utf8") > MAX_REVIEW_CONTEXT_BYTES) includedCount -= 1;
  while (includedExclusions > 0 && Buffer.byteLength(render(candidate()), "utf8") > MAX_REVIEW_CONTEXT_BYTES) includedExclusions -= 1;
  let bounded = candidate();
  if (Buffer.byteLength(render(bounded), "utf8") > MAX_REVIEW_CONTEXT_BYTES) throw new Error("mandatory review context exceeds 96 KiB");
  for (let index = 0; index < includedCount; index += 1) if (originalModules[index].source !== undefined) {
    includedSources.add(index);
    const withSource = candidate();
    if (Buffer.byteLength(render(withSource), "utf8") <= MAX_REVIEW_CONTEXT_BYTES) bounded = withSource;
    else includedSources.delete(index);
  }
  return bounded;
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
  const evidence = { metadata, instructions, boundaries, rules };
  const boundedCatalog = budgetCatalog(catalog, (candidate) => renderContext({ ...evidence, catalog: candidate }));
  return renderContext({ ...evidence, catalog: boundedCatalog });
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
