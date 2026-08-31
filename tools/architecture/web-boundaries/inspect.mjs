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
  codePointCompare,
  isEndpointAuthorityPath,
  isPublicApiEntry,
  isTestOrFixture,
  isTransportPath,
  isTypeScriptSource,
  normalizeBytes,
  normalizedPath,
  physicalLineCount,
  readLegacyBaseline,
  sourceLayer,
} from "./policy.mjs";

const responseBodyMethods = new Set(["json", "text", "arrayBuffer", "blob", "formData", "bytes"]);
const sha256 = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const display = (root, file) => normalizedPath(root, file).replaceAll("\\", "/");
const text = (node, sourceFile) => normalizeBytes(node.getText(sourceFile));

function sourceFiles(sourceRoot) {
  const files = [];
  const visit = (entry) => {
    if (!existsSync(entry)) return;
    if (statSync(entry).isDirectory()) {
      if (!["node_modules", ".next", "dist", "coverage"].includes(path.basename(entry))) for (const child of readdirSync(entry)) visit(path.join(entry, child));
    } else if (isTypeScriptSource(entry) && !isTestOrFixture(entry)) files.push(entry);
  };
  visit(sourceRoot);
  return files.sort(codePointCompare);
}

function resolveModule(specifier, sourceFile, options) {
  const resolved = ts.resolveModuleName(specifier, sourceFile.fileName, options, ts.sys).resolvedModule;
  return resolved?.resolvedFileName ? path.resolve(resolved.resolvedFileName) : specifier.startsWith("@/") ? path.resolve(options.baseUrl, specifier.slice(2)) : undefined;
}

function add(findings, root, rule, file, node, sourceFile, reason, members, evidence) {
  const fingerprintEvidence = evidence ?? (typeof node === "string" ? node : text(node, sourceFile));
  findings.push({ rule, path: display(root, file), kind: typeof node === "string" ? node : ts.SyntaxKind[node.kind], sha256: sha256(fingerprintEvidence), reason, ...(members ? { members: [...members].sort(codePointCompare) } : {}) });
}

function reference(node) {
  return (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier) ? node.moduleSpecifier.text : undefined;
}

function isModuleSpecifierLiteral(node) {
  if (!node.parent) return false;
  if ((ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent)) && node.parent.moduleSpecifier === node) return true;
  return ts.isCallExpression(node.parent) && node.parent.expression.kind === ts.SyntaxKind.ImportKeyword && node.parent.arguments[0] === node;
}

function resolvedSymbol(checker, node) {
  let symbol = checker.getSymbolAtLocation(node);
  if (symbol?.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
  return symbol;
}

function isDomSymbol(symbol, name) {
  return symbol?.getName() === name && symbol.declarations?.some((declaration) => declaration.getSourceFile().isDeclarationFile && /lib\.dom\.d\.ts$/.test(declaration.getSourceFile().fileName));
}

function isGlobalFetch(checker, node) {
  if (!ts.isCallExpression(node)) return false;
  if (ts.isIdentifier(node.expression)) return isDomSymbol(resolvedSymbol(checker, node.expression), "fetch");
  return ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "fetch" && ts.isIdentifier(node.expression.expression) && ["window", "globalThis"].includes(node.expression.expression.text) && isDomSymbol(resolvedSymbol(checker, node.expression.name), "fetch");
}

function isResponseDecoder(checker, node) {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression) || !responseBodyMethods.has(node.expression.name.text)) return false;
  const symbol = resolvedSymbol(checker, node.expression.name);
  return symbol?.getName() === node.expression.name.text && symbol.declarations?.some((declaration) => declaration.getSourceFile().isDeclarationFile && /lib\.dom\.d\.ts$/.test(declaration.getSourceFile().fileName));
}

function isResponseJsonCast(checker, node) {
  return ts.isAsExpression(node) && ts.isCallExpression(node.expression) && ts.isPropertyAccessExpression(node.expression.expression) && node.expression.expression.name.text === "json" && isResponseDecoder(checker, node.expression);
}

function identifierArgument(checker, node) {
  if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression) || !["Number", "parseInt"].includes(node.expression.text) || !node.arguments.length) return false;
  const argument = node.arguments[0];
  const name = ts.isIdentifier(argument) ? argument.text : ts.isPropertyAccessExpression(argument) ? argument.name.text : ts.isElementAccessExpression(argument) && ts.isStringLiteralLike(argument.argumentExpression) ? argument.argumentExpression.text : "";
  if (/(?:^|_)id$/i.test(name) || /Id$/.test(name)) return true;
  const type = checker.getTypeAtLocation(argument);
  return /(?:^|\W)[A-Za-z_$][\w$]*Id(?:\W|$)/.test(checker.typeToString(type)) || /Id$/.test(type.getSymbol()?.getName() ?? "");
}

function isManualType(checker, declaration, seen = new Set()) {
  if (seen.has(declaration)) return false;
  seen.add(declaration);
  if (ts.isInterfaceDeclaration(declaration)) return !declaration.getSourceFile().isDeclarationFile;
  if (!ts.isTypeAliasDeclaration(declaration)) return false;
  if (ts.isTypeLiteralNode(declaration.type)) return true;
  if (ts.isTypeReferenceNode(declaration.type)) {
    const symbol = resolvedSymbol(checker, declaration.type.typeName);
    return (symbol?.declarations ?? []).some((target) => isManualType(checker, target, seen));
  }
  return false;
}

function exportedManualDtos(checker, sourceFile) {
  const module = checker.getSymbolAtLocation(sourceFile);
  if (!module) return [];
  const declarations = [];
  for (const exported of checker.getExportsOfModule(module)) {
    if (!/(?:Response|Dto)$/i.test(exported.getName())) continue;
    const target = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
    for (const declaration of target.declarations ?? []) if (isManualType(checker, declaration)) declarations.push(declaration);
  }
  return [...new Set(declarations)];
}

function exactNamedImport(node, name) {
  if (!ts.isImportDeclaration(node) || !node.importClause || node.importClause.name || !node.importClause.namedBindings || !ts.isNamedImports(node.importClause.namedBindings)) return false;
  const elements = node.importClause.namedBindings.elements;
  return elements.length === 1 && elements[0].name.text === name && !elements[0].propertyName;
}

function exactContractRequestTypeImport(node) {
  return exactNamedImport(node, "ContractRequest") && (node.importClause.isTypeOnly || node.importClause.namedBindings.elements[0].isTypeOnly);
}

function exactRuntimeNamedImport(node, name) {
  return exactNamedImport(node, name) && !node.importClause.isTypeOnly && !node.importClause.namedBindings.elements[0].isTypeOnly;
}

function transportViolation(layer, file, target, node) {
  if (layer?.layer !== "api" || !layer.slice || layer.slice === "_transport" || !target?.replaceAll("\\", "/").includes("/api/_transport/")) return undefined;
  const normalized = target.replaceAll("\\", "/");
  const sourceName = path.basename(file).replace(/\.[cm]?tsx?$/, "");
  if (/\/browser-request(?:\.[cm]?tsx?)?$/.test(normalized)) return sourceName === "index" && exactRuntimeNamedImport(node, "browserRequest") ? undefined : "browser-request는 index.ts의 exact runtime import만 허용합니다.";
  if (/\/server-request\.server(?:\.[cm]?tsx?)?$/.test(normalized)) return sourceName === "server" && exactRuntimeNamedImport(node, "serverRequest") ? undefined : "server-request.server는 server.ts의 exact runtime import만 허용합니다.";
  if (/\/request-contract(?:\.[cm]?tsx?)?$/.test(normalized)) return sourceName !== "index" && sourceName !== "server" && exactContractRequestTypeImport(node) ? undefined : "resource operation은 ContractRequest만 exact type-only import할 수 있습니다.";
  return "resource는 승인되지 않은 api/_transport module을 import 또는 re-export할 수 없습니다.";
}

export async function inspectWebBoundaries({ repoRoot, sourceRoot, baselinePath }) {
  const root = path.resolve(repoRoot);
  const source = path.resolve(sourceRoot);
  const files = sourceFiles(source);
  const options = { allowJs: false, baseUrl: source, jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, paths: { "@/*": ["*"] }, target: ts.ScriptTarget.ESNext };
  const program = ts.createProgram({ rootNames: files, options });
  const checker = program.getTypeChecker();
  const sourceByName = new Map(program.getSourceFiles().map((item) => [path.resolve(item.fileName), item]));
  const findings = [];
  const duplicates = new Map();
  const manualDeclarations = new Set();
  for (const file of files) {
    const sourceFile = sourceByName.get(path.resolve(file));
    if (!sourceFile) continue;
    const normalized = normalizeBytes(readFileSync(file, "utf8"));
    if (physicalLineCount(normalized) > MAX_SOURCE_LINES) add(findings, root, WEB_BOUNDARY_RULES.SOURCE_FILE_SIZE, file, "SourceFile", sourceFile, `${MAX_SOURCE_LINES}줄을 넘는 source file은 책임 분리 또는 reviewed waiver가 필요합니다.`, undefined, normalized);
    const nonblank = normalized.split("\n").filter((line) => line.trim()).length;
    if (nonblank >= MIN_DUPLICATE_NONBLANK_LINES && Buffer.byteLength(normalized) >= MIN_DUPLICATE_BYTES) {
      const key = sha256(normalized);
      const candidate = duplicates.get(key) ?? { evidence: normalized, members: [] };
      candidate.members.push(display(root, file));
      duplicates.set(key, candidate);
    }
    const layer = sourceLayer(file);
    if (sourceFile.statements.some((statement) => ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression) && statement.expression.text === "use client") && /\/(?:page|layout)\.[cm]?tsx?$/.test(file.replaceAll("\\", "/"))) add(findings, root, WEB_BOUNDARY_RULES.ROUTE_CLIENT_COMPONENT, file, "SourceFile", sourceFile, "page.tsx와 layout.tsx는 Server Component를 기본으로 유지해야 합니다.", undefined, normalized);
    if (layer?.layer === "api") for (const declaration of exportedManualDtos(checker, sourceFile)) {
      const declarationFile = declaration.getSourceFile();
      const key = `${declarationFile.fileName}\0${declaration.getStart(declarationFile)}`;
      if (!manualDeclarations.has(key)) {
        manualDeclarations.add(key);
        add(findings, root, WEB_BOUNDARY_RULES.MANUAL_API_RESPONSE, declarationFile.fileName, declaration, declarationFile, "src/api의 public response는 수동 선언이 아닌 contract-inferred type이어야 합니다.");
      }
    }
    const visit = (node) => {
      const specifier = reference(node);
      if (specifier) {
        const target = resolveModule(specifier, sourceFile, options);
        const targetLayer = target ? sourceLayer(target) : undefined;
        if (layer?.layer === "shell" && targetLayer && ["api", "capabilities"].includes(targetLayer.layer)) add(findings, root, WEB_BOUNDARY_RULES.SHELL_BOUNDARY_IMPORT, file, node, sourceFile, "shell은 API resource나 capability를 import 또는 re-export할 수 없습니다.");
        if (layer?.layer === "capabilities" && targetLayer?.layer === "capabilities" && targetLayer.slice !== layer.slice && !/\/index\.[cm]?tsx?$/.test(target ?? "")) add(findings, root, WEB_BOUNDARY_RULES.CAPABILITY_INTERNAL_IMPORT, file, node, sourceFile, "capability 간에는 상대 capability의 public index만 사용할 수 있습니다.");
        if (layer?.layer === "api" && layer.slice && layer.slice !== "_transport" && targetLayer?.layer === "api" && targetLayer.slice && targetLayer.slice !== "_transport" && targetLayer.slice !== layer.slice) add(findings, root, WEB_BOUNDARY_RULES.API_RESOURCE_CROSS_IMPORT, file, node, sourceFile, "API resource는 다른 resource를 직접 import 또는 re-export할 수 없습니다.");
        if (targetLayer?.layer === "api" && targetLayer.slice && targetLayer.slice !== "_transport" && !isPublicApiEntry(target) && !(layer?.layer === "api" && layer.slice === targetLayer.slice)) add(findings, root, WEB_BOUNDARY_RULES.WEB_API_DEEP_IMPORT, file, node, sourceFile, "external consumer는 API resource의 index.ts 또는 server.ts public entry만 사용할 수 있습니다.");
        const violation = transportViolation(layer, file, target, node);
        if (violation) add(findings, root, WEB_BOUNDARY_RULES.RESOURCE_TRANSPORT_IMPORT, file, node, sourceFile, violation);
      }
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "ENDPOINTS") add(findings, root, WEB_BOUNDARY_RULES.FRONTEND_ENDPOINTS_MIRROR, file, node, sourceFile, "frontend ENDPOINTS mirror는 canonical operation contract를 중복합니다.");
      if (ts.isStringLiteralLike(node) && !isEndpointAuthorityPath(file) && !isModuleSpecifierLiteral(node) && /\/api\/v\d+(?:\/|$)/.test(node.text)) add(findings, root, WEB_BOUNDARY_RULES.API_ENDPOINT_LITERAL, file, node, sourceFile, "canonical /api/vN path literal은 operation contract 밖에서 중복할 수 없습니다.");
      if (!isTransportPath(file) && isGlobalFetch(checker, node)) add(findings, root, WEB_BOUNDARY_RULES.RAW_FETCH, file, node, sourceFile, "raw fetch는 src/api/_transport에서만 수행할 수 있습니다.");
      if (!isTransportPath(file) && isResponseJsonCast(checker, node)) add(findings, root, WEB_BOUNDARY_RULES.UNCHECKED_JSON_CAST, file, node, sourceFile, "Response.json() as는 runtime contract parsing을 우회합니다.");
      else if (!isTransportPath(file) && isResponseDecoder(checker, node) && (!node.parent || !ts.isAsExpression(node.parent))) add(findings, root, node.expression.name.text === "json" ? WEB_BOUNDARY_RULES.UNCHECKED_RESPONSE_JSON : WEB_BOUNDARY_RULES.UNCHECKED_RESPONSE_BODY, file, node, sourceFile, "Response body decode는 api/_transport 밖에서 수행할 수 없습니다.");
      if (identifierArgument(checker, node)) add(findings, root, WEB_BOUNDARY_RULES.ID_NUMBER_CONVERSION, file, node, sourceFile, "contract identifier를 Number 또는 parseInt로 변환하면 bigint 정밀도를 잃을 수 있습니다.");
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  for (const candidate of duplicates.values()) if (candidate.members.length > 1) {
    const members = [...candidate.members].sort(codePointCompare);
    add(findings, root, WEB_BOUNDARY_RULES.DUPLICATE_SOURCE_GROUP, path.join(root, members[0]), "SourceFileGroup", undefined, "동일한 큰 source group은 shared extraction 또는 의도적인 분리를 검토해야 합니다.", members, `${sha256(candidate.evidence)}\n${members.join("\n")}`);
  }
  findings.sort((left, right) => codePointCompare(`${left.rule}\0${left.path}\0${left.sha256}`, `${right.rule}\0${right.path}\0${right.sha256}`));
  const { baseline, baselineFailures } = readLegacyBaseline(baselinePath);
  const matched = applyLegacyBaseline(findings, baseline);
  return { findings, unmatchedFindings: matched.unmatchedFindings, baselineFailures: [...baselineFailures, ...matched.baselineFailures] };
}
