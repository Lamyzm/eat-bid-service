import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import {
  MAX_SOURCE_LINES,
  MIN_DUPLICATE_BYTES,
  MIN_DUPLICATE_NONBLANK_LINES,
  WEB_BOUNDARY_RULES,
  applyLegacyBaseline,
  isPublicApiEntry,
  isTestOrFixture,
  isTransportPath,
  isTypeScriptSource,
  normalizeBytes,
  normalizedPath,
  readLegacyBaseline,
  sourceLayer,
} from "./policy.mjs";

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function sourceFiles(sourceRoot) {
  const files = [];
  const visit = (entry) => {
    if (!existsSync(entry)) return;
    const stats = statSync(entry);
    if (stats.isDirectory()) {
      if (["node_modules", ".next", "dist", "coverage"].includes(path.basename(entry))) return;
      for (const child of readdirSync(entry)) visit(path.join(entry, child));
      return;
    }
    if (isTypeScriptSource(entry) && !isTestOrFixture(entry)) files.push(entry);
  };
  visit(sourceRoot);
  return files.sort((left, right) => left.localeCompare(right));
}

function compilerOptions(sourceRoot) {
  return {
    allowJs: false,
    baseUrl: sourceRoot,
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    paths: { "@/*": ["*"] },
    target: ts.ScriptTarget.ESNext,
  };
}

function resolveImport(specifier, sourceFile, options) {
  const resolved = ts.resolveModuleName(specifier, sourceFile.fileName, options, ts.sys).resolvedModule;
  if (resolved?.resolvedFileName) return path.resolve(resolved.resolvedFileName);
  if (specifier.startsWith("@/")) return path.resolve(options.baseUrl, specifier.slice(2));
  return undefined;
}

function nodeText(node, sourceFile) {
  return normalizeBytes(node.getText(sourceFile));
}

function isJsonCall(node) {
  return ts.isCallExpression(node)
    && ts.isPropertyAccessExpression(node.expression)
    && node.expression.name.text === "json";
}

function isFetchCall(node) {
  if (!ts.isCallExpression(node)) return false;
  if (ts.isIdentifier(node.expression)) return node.expression.text === "fetch";
  return ts.isPropertyAccessExpression(node.expression)
    && node.expression.name.text === "fetch"
    && ts.isIdentifier(node.expression.expression)
    && ["window", "globalThis"].includes(node.expression.expression.text);
}

function isNumberConversion(node) {
  return ts.isCallExpression(node)
    && ts.isIdentifier(node.expression)
    && ["Number", "parseInt"].includes(node.expression.text)
    && node.arguments.length > 0
    && !ts.isStringLiteralLike(node.arguments[0])
    && !ts.isNumericLiteral(node.arguments[0]);
}

function hasUseClientDirective(sourceFile) {
  return sourceFile.statements.some((statement) => ts.isExpressionStatement(statement)
    && ts.isStringLiteral(statement.expression)
    && statement.expression.text === "use client");
}

function declarationName(node) {
  return node.name && ts.isIdentifier(node.name) ? node.name.text : undefined;
}

function isExported(node) {
  return Boolean(ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export);
}

function reportPath(repoRoot, file) {
  return normalizedPath(repoRoot, file).replaceAll("\\", "/");
}

function finding({ rule, file, kind, evidence, reason, repoRoot, members }) {
  return {
    rule,
    path: reportPath(repoRoot, file),
    kind,
    sha256: sha256(evidence),
    reason,
    ...(members ? { members: [...members].sort() } : {}),
  };
}

export async function inspectWebBoundaries({ repoRoot, sourceRoot, baselinePath }) {
  const resolvedRoot = path.resolve(repoRoot);
  const resolvedSourceRoot = path.resolve(sourceRoot);
  const files = sourceFiles(resolvedSourceRoot);
  const options = compilerOptions(resolvedSourceRoot);
  const program = ts.createProgram({ rootNames: files, options });
  const sourceByName = new Map(program.getSourceFiles().map((sourceFile) => [path.resolve(sourceFile.fileName), sourceFile]));
  const findings = [];
  const duplicateCandidates = new Map();

  for (const file of files) {
    const sourceFile = sourceByName.get(path.resolve(file));
    if (!sourceFile) continue;
    const sourcePath = reportPath(resolvedRoot, file);
    const normalized = normalizeBytes(readFileSync(file, "utf8"));
    const physicalLines = normalized.split("\n").length;
    if (physicalLines > MAX_SOURCE_LINES) {
      findings.push(finding({
        rule: WEB_BOUNDARY_RULES.SOURCE_FILE_SIZE,
        file,
        kind: "SourceFile",
        evidence: normalized,
        reason: `${MAX_SOURCE_LINES}줄을 넘는 source file은 책임 분리 또는 reviewed waiver가 필요합니다.`,
        repoRoot: resolvedRoot,
      }));
    }
    const nonblankLines = normalized.split("\n").filter((line) => line.trim()).length;
    if (nonblankLines >= MIN_DUPLICATE_NONBLANK_LINES && Buffer.byteLength(normalized) >= MIN_DUPLICATE_BYTES) {
      const key = sha256(normalized);
      const group = duplicateCandidates.get(key) ?? { evidence: normalized, members: [] };
      group.members.push(sourcePath);
      duplicateCandidates.set(key, group);
    }
    const layer = sourceLayer(file);

    if (hasUseClientDirective(sourceFile) && /\/(?:page|layout)\.[cm]?tsx?$/.test(file.replaceAll("\\", "/"))) {
      findings.push(finding({
        rule: WEB_BOUNDARY_RULES.ROUTE_CLIENT_COMPONENT,
        file,
        kind: "SourceFile",
        evidence: normalized,
        reason: "page.tsx와 layout.tsx는 Server Component를 기본으로 유지해야 합니다.",
        repoRoot: resolvedRoot,
      }));
    }

    const visit = (node) => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
        const specifier = node.moduleSpecifier.text;
        const target = resolveImport(specifier, sourceFile, options);
        const targetLayer = target ? sourceLayer(target) : undefined;
        if (layer?.layer === "shell" && targetLayer && ["api", "capabilities"].includes(targetLayer.layer)) {
          findings.push(finding({ rule: WEB_BOUNDARY_RULES.SHELL_BOUNDARY_IMPORT, file, kind: "ImportDeclaration", evidence: nodeText(node, sourceFile), reason: "shell은 API resource나 capability를 import할 수 없습니다.", repoRoot: resolvedRoot }));
        }
        if (layer?.layer === "capabilities" && targetLayer?.layer === "capabilities" && targetLayer.slice !== layer.slice && !/\/index\.[cm]?tsx?$/.test(target ?? "")) {
          findings.push(finding({ rule: WEB_BOUNDARY_RULES.CAPABILITY_INTERNAL_IMPORT, file, kind: "ImportDeclaration", evidence: nodeText(node, sourceFile), reason: "capability 간에는 상대 capability의 public index만 사용할 수 있습니다.", repoRoot: resolvedRoot }));
        }
        if (layer?.layer === "api" && layer.slice && layer.slice !== "_transport" && targetLayer?.layer === "api" && targetLayer.slice && targetLayer.slice !== "_transport" && targetLayer.slice !== layer.slice) {
          findings.push(finding({ rule: WEB_BOUNDARY_RULES.API_RESOURCE_CROSS_IMPORT, file, kind: "ImportDeclaration", evidence: nodeText(node, sourceFile), reason: "API resource는 다른 resource를 직접 import할 수 없습니다.", repoRoot: resolvedRoot }));
        }
        if (/\/src\/app\//.test(file.replaceAll("\\", "/")) && targetLayer?.layer === "api" && targetLayer.slice && !isPublicApiEntry(target)) {
          findings.push(finding({ rule: WEB_BOUNDARY_RULES.WEB_API_DEEP_IMPORT, file, kind: "ImportDeclaration", evidence: nodeText(node, sourceFile), reason: "route는 API resource의 index.ts 또는 server.ts public entry만 import할 수 있습니다.", repoRoot: resolvedRoot }));
        }
      }
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "ENDPOINTS") {
        findings.push(finding({ rule: WEB_BOUNDARY_RULES.FRONTEND_ENDPOINTS_MIRROR, file, kind: "VariableDeclaration", evidence: nodeText(node, sourceFile), reason: "frontend ENDPOINTS mirror는 canonical operation contract를 중복합니다.", repoRoot: resolvedRoot }));
      }
      if ((ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) && isExported(node) && /(?:Response|Dto)$/i.test(declarationName(node) ?? "") && /\/src\/api\//.test(file.replaceAll("\\", "/"))) {
        findings.push(finding({ rule: WEB_BOUNDARY_RULES.MANUAL_API_RESPONSE, file, kind: ts.SyntaxKind[node.kind], evidence: nodeText(node, sourceFile), reason: "src/api의 public response는 수동 선언이 아닌 contract-inferred type이어야 합니다.", repoRoot: resolvedRoot }));
      }
      if (ts.isStringLiteralLike(node) && node.text.includes("/api/v1/")) {
        findings.push(finding({ rule: WEB_BOUNDARY_RULES.API_ENDPOINT_LITERAL, file, kind: "StringLiteral", evidence: nodeText(node, sourceFile), reason: "canonical /api/v1 path literal은 operation contract 밖에서 중복할 수 없습니다.", repoRoot: resolvedRoot }));
      }
      if (!isTransportPath(file) && isFetchCall(node)) {
        findings.push(finding({ rule: WEB_BOUNDARY_RULES.RAW_FETCH, file, kind: "CallExpression", evidence: nodeText(node, sourceFile), reason: "raw fetch는 src/api/_transport에서만 수행할 수 있습니다.", repoRoot: resolvedRoot }));
      }
      if (!isTransportPath(file) && ts.isAsExpression(node) && isJsonCall(node.expression)) {
        findings.push(finding({ rule: WEB_BOUNDARY_RULES.UNCHECKED_JSON_CAST, file, kind: "AsExpression", evidence: nodeText(node, sourceFile), reason: "Response.json() as는 runtime contract parsing을 우회합니다.", repoRoot: resolvedRoot }));
      } else if (!isTransportPath(file) && isJsonCall(node) && (!node.parent || !ts.isAsExpression(node.parent))) {
        findings.push(finding({ rule: WEB_BOUNDARY_RULES.UNCHECKED_RESPONSE_JSON, file, kind: "CallExpression", evidence: nodeText(node, sourceFile), reason: "Response.json()은 api/_transport 밖에서 decode할 수 없습니다.", repoRoot: resolvedRoot }));
      }
      if (isNumberConversion(node)) {
        findings.push(finding({ rule: WEB_BOUNDARY_RULES.ID_NUMBER_CONVERSION, file, kind: "CallExpression", evidence: nodeText(node, sourceFile), reason: "identifier를 Number 또는 parseInt로 변환하면 bigint 정밀도를 잃을 수 있습니다.", repoRoot: resolvedRoot }));
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  for (const group of duplicateCandidates.values()) {
    if (group.members.length < 2) continue;
    findings.push(finding({
      rule: WEB_BOUNDARY_RULES.DUPLICATE_SOURCE_GROUP,
      file: path.join(resolvedRoot, group.members[0]),
      kind: "SourceFileGroup",
      evidence: group.evidence,
      reason: "동일한 큰 source group은 shared extraction 또는 의도적인 분리를 검토해야 합니다.",
      repoRoot: resolvedRoot,
      members: group.members,
    }));
  }

  findings.sort((left, right) => `${left.rule}\0${left.path}\0${left.sha256}`.localeCompare(`${right.rule}\0${right.path}\0${right.sha256}`));
  const { baseline, baselineFailures: readFailures } = readLegacyBaseline(baselinePath);
  const baselineResult = applyLegacyBaseline(findings, baseline);
  return {
    findings,
    unmatchedFindings: baselineResult.unmatchedFindings,
    baselineFailures: [...readFailures, ...baselineResult.baselineFailures],
  };
}
