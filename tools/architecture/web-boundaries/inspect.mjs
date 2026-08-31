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
  const finding = { rule, path: display(root, file), kind: typeof node === "string" ? node : ts.SyntaxKind[node.kind], sha256: sha256(fingerprintEvidence), reason, ...(members ? { members: [...members].sort(codePointCompare) } : {}) };
  findings.push(finding);
  return finding;
}

function reference(node) {
  if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) return node.moduleSpecifier.text;
  return ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments.length === 1 && ts.isStringLiteralLike(node.arguments[0]) ? node.arguments[0].text : undefined;
}

function isModuleSpecifierLiteral(node) {
  if (!node.parent) return false;
  if ((ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent)) && node.parent.moduleSpecifier === node) return true;
  return ts.isCallExpression(node.parent) && node.parent.expression.kind === ts.SyntaxKind.ImportKeyword && node.parent.arguments[0] === node;
}

function endpointLiteralText(node) {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isTemplateExpression(node)) return `${node.head.text}${node.templateSpans.map((span) => `${staticPrimitiveText(span.expression) ?? "\u0000"}${span.literal.text}`).join("")}`;
  return undefined;
}

function staticPrimitiveText(node) {
  if (ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) return node.text;
  if (node.kind === ts.SyntaxKind.TrueKeyword) return "true";
  if (node.kind === ts.SyntaxKind.FalseKeyword) return "false";
  if (node.kind === ts.SyntaxKind.NullKeyword) return "null";
  if (ts.isParenthesizedExpression(node)) return staticPrimitiveText(node.expression);
  if (ts.isPrefixUnaryExpression(node) && [ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken].includes(node.operator)) {
    const operand = staticPrimitiveText(node.operand);
    return operand === undefined ? undefined : `${node.operator === ts.SyntaxKind.MinusToken ? "-" : ""}${operand}`;
  }
  return undefined;
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

function typeHasDomResponseBase(checker, type, seen = new Set()) {
  const apparent = checker.getApparentType(type);
  if (seen.has(apparent)) return false;
  seen.add(apparent);
  if (isDomSymbol(apparent.getSymbol?.(), "Response") || isDomSymbol(apparent.aliasSymbol, "Response")) return true;
  if (apparent.isUnionOrIntersection?.()) return apparent.types.some((member) => typeHasDomResponseBase(checker, member, seen));
  const bases = typeof apparent.getBaseTypes === "function" ? apparent.getBaseTypes() ?? [] : [];
  return bases.some((base) => typeHasDomResponseBase(checker, base, seen));
}

function hasDomResponseBase(checker, node) {
  const type = checker.getTypeAtLocation(node);
  return typeHasDomResponseBase(checker, type);
}

function decoderAccess(node) {
  if (ts.isPropertyAccessExpression(node) && responseBodyMethods.has(node.name.text)) return { name: node.name.text, receiver: node.expression };
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) && responseBodyMethods.has(node.argumentExpression.text)) return { name: node.argumentExpression.text, receiver: node.expression };
  return undefined;
}

function isDomResponsePrototype(checker, node) {
  return ts.isPropertyAccessExpression(node) && node.name.text === "prototype" && ts.isIdentifier(node.expression) && isDomSymbol(resolvedSymbol(checker, node.expression), "Response");
}

function responseDecoder(checker, node) {
  if (!ts.isCallExpression(node)) return undefined;
  const direct = decoderAccess(node.expression);
  if (direct && hasDomResponseBase(checker, direct.receiver)) return direct.name;
  if (!ts.isPropertyAccessExpression(node.expression) || !["call", "apply", "bind"].includes(node.expression.name.text) || !node.arguments.length) return undefined;
  const prototypeMethod = decoderAccess(node.expression.expression);
  return prototypeMethod && isDomResponsePrototype(checker, prototypeMethod.receiver) && hasDomResponseBase(checker, node.arguments[0]) ? prototypeMethod.name : undefined;
}

function isResponseJsonCast(checker, node) {
  return ts.isAsExpression(node) && responseDecoder(checker, node.expression) === "json";
}

function identifierArgument(checker, node) {
  if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression) || !["Number", "parseInt"].includes(node.expression.text) || !node.arguments.length) return false;
  const argument = node.arguments[0];
  const name = ts.isIdentifier(argument) ? argument.text : ts.isPropertyAccessExpression(argument) ? argument.name.text : ts.isElementAccessExpression(argument) && ts.isStringLiteralLike(argument.argumentExpression) ? argument.argumentExpression.text : "";
  if (/(?:^|_)id$/i.test(name) || /Id$/.test(name)) return true;
  const type = checker.getTypeAtLocation(argument);
  return /(?:^|\W)[A-Za-z_$][\w$]*Id(?:\W|$)/.test(checker.typeToString(type)) || /Id$/.test(type.getSymbol()?.getName() ?? "");
}

function isContractDeclaration(root, declaration) {
  const declarationPath = display(root, declaration.getSourceFile().fileName);
  return declarationPath.startsWith("packages/contracts/src/api/") || /(?:^|\/)node_modules\/@eatbid\/contracts(?:\/|$)/.test(declarationPath);
}

function isBuiltinDeclaration(declaration) {
  return declaration.getSourceFile().isDeclarationFile && /^lib\..*\.d\.ts$/i.test(path.basename(declaration.getSourceFile().fileName));
}

function manualTypeNode(root, checker, node, seenDeclarations = new Set(), seenNodes = new Set()) {
  if (!node || seenNodes.has(node)) return false;
  seenNodes.add(node);
  if (ts.isTypeLiteralNode(node) || ts.isMappedTypeNode(node) || ts.isTupleTypeNode(node) || ts.isArrayTypeNode(node)) return true;
  if (ts.isParenthesizedTypeNode(node) || ts.isTypeOperatorNode(node) || ts.isRestTypeNode(node) || ts.isOptionalTypeNode(node)) return manualTypeNode(root, checker, node.type, seenDeclarations, seenNodes);
  if (ts.isUnionTypeNode(node) || ts.isIntersectionTypeNode(node)) return node.types.some((type) => manualTypeNode(root, checker, type, seenDeclarations, seenNodes));
  if (ts.isIndexedAccessTypeNode(node)) return manualTypeNode(root, checker, node.objectType, seenDeclarations, seenNodes) || manualTypeNode(root, checker, node.indexType, seenDeclarations, seenNodes);
  if (ts.isConditionalTypeNode(node)) return [node.checkType, node.extendsType, node.trueType, node.falseType].some((type) => manualTypeNode(root, checker, type, seenDeclarations, seenNodes));
  if (!ts.isTypeReferenceNode(node)) return false;
  if (node.typeArguments?.some((argument) => manualTypeNode(root, checker, argument, seenDeclarations, seenNodes))) return true;
  const symbol = resolvedSymbol(checker, node.typeName);
  if (symbol?.getName() === "Record") return true;
  return (symbol?.declarations ?? []).some((declaration) => manualDeclaration(root, checker, declaration, seenDeclarations, seenNodes));
}

function manualDeclaration(root, checker, declaration, seenDeclarations = new Set(), seenNodes = new Set()) {
  if (seenDeclarations.has(declaration) || isContractDeclaration(root, declaration) || isBuiltinDeclaration(declaration)) return false;
  seenDeclarations.add(declaration);
  if (ts.isInterfaceDeclaration(declaration)) return true;
  if (ts.isTypeAliasDeclaration(declaration)) return manualTypeNode(root, checker, declaration.type, seenDeclarations, seenNodes);
  return false;
}

function exportedManualDtos(root, checker, sourceFile) {
  const module = checker.getSymbolAtLocation(sourceFile);
  if (!module) return [];
  const declarations = [];
  for (const exported of checker.getExportsOfModule(module)) {
    if (!/(?:Response|Dto)$/i.test(exported.getName())) continue;
    const target = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
    for (const declaration of target.declarations ?? []) if (manualDeclaration(root, checker, declaration)) declarations.push(declaration);
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

function resourceFile(root, file) {
  return display(root, file).match(/^apps\/web\/src\/api\/([^/]+)\/([^/]+\.[cm]?tsx?)$/);
}

function transportViolation(root, layer, file, target, node) {
  if (!target) return undefined;
  const targetPath = display(root, target);
  if (!targetPath.startsWith("apps/web/src/api/_transport/")) return undefined;
  if (layer?.layer === "api" && layer.slice === "_transport") return undefined;
  const source = resourceFile(root, file);
  const isResource = layer?.layer === "api" && layer.slice && layer.slice !== "_transport" && source?.[1] === layer.slice;
  const isResourceIndex = isResource && source[2] === "index.ts";
  const isResourceServer = isResource && source[2] === "server.ts";
  const isOperation = isResource && !["index.ts", "server.ts"].includes(source[2]);
  if (targetPath === "apps/web/src/api/_transport/browser-request.ts") return isResourceIndex && exactRuntimeNamedImport(node, "browserRequest") ? undefined : "browser-request는 exact resource index.ts의 exact runtime import만 허용합니다.";
  if (targetPath === "apps/web/src/api/_transport/server-request.server.ts") return isResourceServer && exactRuntimeNamedImport(node, "serverRequest") ? undefined : "server-request.server는 exact resource server.ts의 exact runtime import만 허용합니다.";
  if (targetPath === "apps/web/src/api/_transport/request-contract.ts") return isOperation && exactContractRequestTypeImport(node) ? undefined : "resource operation은 exact ContractRequest만 exact type-only import할 수 있습니다.";
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
    if (layer?.layer === "api") for (const declaration of exportedManualDtos(root, checker, sourceFile)) {
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
        const violation = transportViolation(root, layer, file, target, node);
        if (violation) add(findings, root, WEB_BOUNDARY_RULES.RESOURCE_TRANSPORT_IMPORT, file, node, sourceFile, violation);
      }
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "ENDPOINTS") add(findings, root, WEB_BOUNDARY_RULES.FRONTEND_ENDPOINTS_MIRROR, file, node, sourceFile, "frontend ENDPOINTS mirror는 canonical operation contract를 중복합니다.");
      const endpoint = endpointLiteralText(node);
      if (endpoint !== undefined && !isEndpointAuthorityPath(root, file) && !isModuleSpecifierLiteral(node) && /\/api\/v\d+(?:\/|$)/.test(endpoint)) add(findings, root, WEB_BOUNDARY_RULES.API_ENDPOINT_LITERAL, file, node, sourceFile, "canonical /api/vN path literal은 operation contract 밖에서 중복할 수 없습니다.");
      if (!isTransportPath(file) && isGlobalFetch(checker, node)) add(findings, root, WEB_BOUNDARY_RULES.RAW_FETCH, file, node, sourceFile, "raw fetch는 src/api/_transport에서만 수행할 수 있습니다.");
      if (!isTransportPath(file) && isResponseJsonCast(checker, node)) add(findings, root, WEB_BOUNDARY_RULES.UNCHECKED_JSON_CAST, file, node, sourceFile, "Response.json() as는 runtime contract parsing을 우회합니다.");
      else if (!isTransportPath(file)) {
        const decoder = responseDecoder(checker, node);
        if (decoder && (!node.parent || !ts.isAsExpression(node.parent))) add(findings, root, decoder === "json" ? WEB_BOUNDARY_RULES.UNCHECKED_RESPONSE_JSON : WEB_BOUNDARY_RULES.UNCHECKED_RESPONSE_BODY, file, node, sourceFile, "Response body decode는 api/_transport 밖에서 수행할 수 없습니다.");
      }
      if (identifierArgument(checker, node)) add(findings, root, WEB_BOUNDARY_RULES.ID_NUMBER_CONVERSION, file, node, sourceFile, "contract identifier를 Number 또는 parseInt로 변환하면 bigint 정밀도를 잃을 수 있습니다.");
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  for (const candidate of duplicates.values()) if (candidate.members.length > 1) {
    const members = [...candidate.members].sort(codePointCompare);
    const finding = add(findings, root, WEB_BOUNDARY_RULES.DUPLICATE_SOURCE_GROUP, path.join(root, members[0]), "SourceFileGroup", undefined, "동일한 큰 source group은 shared extraction 또는 의도적인 분리를 검토해야 합니다.", members, `${sha256(candidate.evidence)}\n${members.join("\n")}`);
    finding.contentSha256 = sha256(candidate.evidence);
  }
  findings.sort((left, right) => codePointCompare(`${left.rule}\0${left.path}\0${left.sha256}`, `${right.rule}\0${right.path}\0${right.sha256}`));
  const { baseline, baselineFailures } = readLegacyBaseline(baselinePath);
  const matched = applyLegacyBaseline(findings, baseline);
  return { findings, unmatchedFindings: matched.unmatchedFindings, baselineFailures: [...baselineFailures, ...matched.baselineFailures] };
}
