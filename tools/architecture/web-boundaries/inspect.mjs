/** @module 책임: Web source를 정적 분석해 import·transport·DTO·크기·중복 경계 위반과 안정적인 legacy fingerprint를 계산한다. */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { clientValueExportCrossings } from "./client-value-exports.mjs";
import { exportedManualDtos } from "./dto-provenance.mjs";
import { isDomLibrarySymbol, isGlobalFetchCall } from "./global-fetch-analysis.mjs";
import {
  MAX_SOURCE_LINES,
  MIN_DUPLICATE_BYTES,
  MIN_DUPLICATE_NONBLANK_LINES,
  WEB_BOUNDARY_RULES,
  applyLegacyBaseline,
  codePointCompare,
  isCacheOwnerPath,
  isCanonicalLayerPath,
  isClientDomainCalculationPath,
  isEndpointAuthorityPath,
  isLegacyDirectoryReference,
  isLegacyHooksPath,
  isLegacyIdentityScope,
  isLegacyLibPath,
  isLegacyRouteLiteral,
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
import { staticExpression, staticPropertyName, unwrapExpression } from "./static-analysis.mjs";

// 이 모듈은 Web source 전체를 한 TypeScript program으로 검사해 deterministic boundary finding을 만든다.
// 세부 의미 분석은 전용 모듈에 위임하고, 여기서는 path 소유권·fingerprint·baseline 경계만 조립한다.
const responseBodyMethods = new Set(["json", "text", "arrayBuffer", "blob", "formData", "bytes"]);
const sha256 = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const display = (root, file) => normalizedPath(root, file).replaceAll("\\", "/");
const text = (node, sourceFile) => normalizeBytes(node.getText(sourceFile));
const sourceFingerprintEvidence = (source) => source.replace(/^\s*\/\*\*\s*@module 책임:[\s\S]*?\*\/[ \t]*(?:\n|$)/u, "");

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

// SyntaxKind enum은 VariableStatement처럼 alias가 겹친 값을 "FirstStatement"로 되돌리므로 baseline key에는 안정된 이름을 쓴다.
function kindName(node) {
  if (typeof node === "string") return node;
  return ts.isVariableStatement(node) ? "VariableStatement" : ts.SyntaxKind[node.kind];
}

function add(findings, root, rule, file, node, sourceFile, reason, members, evidence) {
  const fingerprintEvidence = evidence ?? (typeof node === "string" ? node : text(node, sourceFile));
  const finding = { rule, path: display(root, file), kind: kindName(node), sha256: sha256(fingerprintEvidence), reason, ...(members ? { members: [...members].sort(codePointCompare) } : {}) };
  findings.push(finding);
  return finding;
}

function reference(checker, node) {
  if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) return { text: node.moduleSpecifier.text, dynamic: false };
  // `typeof import('...')` type query도 module graph edge이므로 값 import와 같은 경계 규칙을 적용한다.
  if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteralLike(node.argument.literal)) return { text: node.argument.literal.text, dynamic: false };
  if (!ts.isCallExpression(node) || node.expression.kind !== ts.SyntaxKind.ImportKeyword || node.arguments.length !== 1) return undefined;
  const evaluated = staticExpression(checker, node.arguments[0]);
  return { text: evaluated.text, dynamic: true, known: evaluated.known };
}

function isModuleSpecifierLiteral(node) {
  if (!node.parent) return false;
  if ((ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent)) && node.parent.moduleSpecifier === node) return true;
  if (ts.isLiteralTypeNode(node.parent) && node.parent.literal === node && ts.isImportTypeNode(node.parent.parent) && node.parent.parent.argument === node.parent) return true;
  return ts.isCallExpression(node.parent) && node.parent.expression.kind === ts.SyntaxKind.ImportKeyword && node.parent.arguments[0] === node;
}

function resolvedSymbol(checker, node) {
  let symbol = checker.getSymbolAtLocation(node);
  if (symbol?.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
  return symbol;
}

function typeHasDomResponseBase(checker, type, seen = new Set()) {
  const apparent = checker.getApparentType(type);
  if (seen.has(apparent)) return false;
  seen.add(apparent);
  if (isDomLibrarySymbol(apparent.getSymbol?.(), "Response") || isDomLibrarySymbol(apparent.aliasSymbol, "Response")) return true;
  if (apparent.isUnionOrIntersection?.()) return apparent.types.some((member) => typeHasDomResponseBase(checker, member, seen));
  const bases = typeof apparent.getBaseTypes === "function" ? apparent.getBaseTypes() ?? [] : [];
  return bases.some((base) => typeHasDomResponseBase(checker, base, seen));
}

function hasDomResponseBase(checker, node) {
  const type = checker.getTypeAtLocation(node);
  return typeHasDomResponseBase(checker, type);
}

function decoderAccess(checker, node) {
  const current = unwrapExpression(node);
  const name = staticPropertyName(checker, current);
  if (ts.isPropertyAccessExpression(current) && responseBodyMethods.has(name)) return { name, receiver: current.expression };
  if (ts.isElementAccessExpression(current) && responseBodyMethods.has(name)) return { name, receiver: current.expression };
  return undefined;
}

function isDomResponsePrototype(checker, node) {
  const current = unwrapExpression(node);
  if (!ts.isPropertyAccessExpression(current) || current.name.text !== "prototype") return false;
  const constructor = unwrapExpression(current.expression);
  if (ts.isIdentifier(constructor)) return isDomLibrarySymbol(resolvedSymbol(checker, constructor), "Response");
  return ts.isPropertyAccessExpression(constructor) && constructor.name.text === "Response" && ts.isIdentifier(constructor.expression) && constructor.expression.text === "globalThis" && isDomLibrarySymbol(resolvedSymbol(checker, constructor.name), "Response");
}

function responseDecoder(checker, node) {
  if (!ts.isCallExpression(node)) return undefined;
  const direct = decoderAccess(checker, node.expression);
  if (direct && hasDomResponseBase(checker, direct.receiver)) return direct.name;
  const invoke = unwrapExpression(node.expression);
  const invokeName = staticPropertyName(checker, invoke);
  if (!(ts.isPropertyAccessExpression(invoke) || ts.isElementAccessExpression(invoke)) || !["call", "apply", "bind"].includes(invokeName) || !node.arguments.length) return undefined;
  const method = decoderAccess(checker, invoke.expression);
  if (!method) return undefined;
  if (isDomResponsePrototype(checker, method.receiver)) return hasDomResponseBase(checker, node.arguments[0]) ? method.name : undefined;
  return hasDomResponseBase(checker, method.receiver) ? method.name : undefined;
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

function isCanonicalMotionPath(root, file) {
  return /^apps\/web\/src\/(?:capabilities|shared|shell|app\/\(workspace\))\//.test(
    display(root, file),
  );
}

function isButtonPrimitivePath(root, file) {
  return display(root, file) === "apps/web/src/shared/ui/button.tsx";
}

function isSharedUiPath(root, file) {
  return /^apps\/web\/src\/shared\/ui\//.test(display(root, file));
}

function isRouteLoadingPath(root, file) {
  return /^apps\/web\/src\/app\/(?:.+\/)?loading\.tsx$/.test(display(root, file));
}

function isLegacyPageContainerPath(root, file) {
  return display(root, file) === "apps/web/src/components/layout/page-container.tsx";
}

// 캐시 경계는 directive 하나로 열린다. 함수 안이든 파일 최상단이든 같은 규칙이 적용돼야 하므로
// 위치를 가리지 않고 directive 문장 자체를 찾는다.
function hasUseCacheDirective(sourceFile) {
  let found = false;
  const visit = (node) => {
    if (found) return;
    if (ts.isExpressionStatement(node) && ts.isStringLiteral(node.expression)
      && node.expression.text === "use cache") {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

// 요청마다 다른 입력을 캐시 경계 안에서 읽으면 한 사용자의 응답이 다른 사용자에게 재사용된다.
// 사람 규율이 아니라 이 규칙이 그 동거를 막는다(ADR 0028-4, ADR 0036-8).
const REQUEST_SCOPED_CALLS = new Set(["cookies", "headers", "draftMode", "connection"]);

function usesRequestScopedInput(sourceFile) {
  let found = false;
  const visit = (node) => {
    if (found) return;
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)
      && node.moduleSpecifier.text === "next/headers") {
      found = true;
      return;
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
      && REQUEST_SCOPED_CALLS.has(node.expression.text)) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function isExported(statement) {
  return Boolean(statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));
}

// 삭제 전용 ledger는 export 단위로 fingerprint를 남겨야 함수 하나를 Server 계약으로 옮길 때마다
// 해당 항목만 지울 수 있다. 타입만 export하는 선언은 계산이 아니므로 제외하고, `export { f }` 같은
// 로컬 이름 export는 선언 대신 그 export 문을 항목으로 삼아 우회를 막는다.
// runtime export가 하나도 없는 export 문(`export {}`, `export type { }`, `export { type a }`)은 계산이 아니다.
function isTypeOnlyNamedExport(statement) {
  if (statement.isTypeOnly) return true;
  const clause = statement.exportClause;
  return Boolean(clause && ts.isNamedExports(clause) && clause.elements.every((element) => element.isTypeOnly));
}

function exportedRuntimeStatements(sourceFile) {
  return sourceFile.statements.filter((statement) =>
    (isExported(statement) && (ts.isFunctionDeclaration(statement) || ts.isVariableStatement(statement)))
    || (ts.isExportDeclaration(statement) && !statement.moduleSpecifier && !isTypeOnlyNamedExport(statement)));
}

function exportedNames(statement) {
  if (ts.isFunctionDeclaration(statement)) return [statement.name?.text ?? "default"];
  if (ts.isVariableStatement(statement)) return statement.declarationList.declarations.map((declaration) => declaration.name.getText());
  if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) return statement.exportClause.elements.map((element) => element.name.text);
  return [];
}

function importedScreenSkeletons(sourceFile) {
  const names = new Set();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)
      || !ts.isStringLiteralLike(statement.moduleSpecifier)
      || !statement.moduleSpecifier.text.startsWith(".")) continue;
    const clause = statement.importClause;
    if (clause?.name?.text.endsWith("ScreenSkeleton")) names.add(clause.name.text);
    if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        if (element.name.text.endsWith("ScreenSkeleton")) names.add(element.name.text);
      }
    }
  }
  return names;
}

function routeLoadingReturnsSingleScreenSkeleton(sourceFile) {
  if (sourceFile.statements.some(
    (statement) => ts.isExpressionStatement(statement)
      && ts.isStringLiteral(statement.expression)
      && statement.expression.text === "use client",
  )) return false;
  if (/\banimate-pulse\b|<Skeleton(?:\s|\/|>)/.test(sourceFile.text)) return false;
  const allowedNames = importedScreenSkeletons(sourceFile);
  if (!allowedNames.size) return false;
  const loading = sourceFile.statements.find(
    (statement) => ts.isFunctionDeclaration(statement)
      && statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword),
  );
  if (!loading?.body || loading.body.statements.length !== 1) return false;
  const returned = loading.body.statements[0];
  if (!ts.isReturnStatement(returned) || !returned.expression) return false;
  const expression = unwrapExpression(returned.expression);
  return ts.isJsxSelfClosingElement(expression)
    && ts.isIdentifier(expression.tagName)
    && allowedNames.has(expression.tagName.text)
    && expression.attributes.properties.length === 0;
}

function motionClassViolations(value) {
  return {
    durationLiteral:
      /(?:^|[\s:])duration-(?:\d+|\[(?!var\(--motion-duration-)[^\]]+\])/.test(value),
    localPress: /active:(?:scale|translate(?:-[xy])?)-/.test(value),
    transitionAll: /(?:^|[\s:])transition-all(?:\s|$)/.test(value),
  };
}

function isSharedControlResponsibilityImport(specifier) {
  return /(?:^|[/@_-])(?:auth(?:entication)?|session|permission|telemetry|analytics|tracking?|sentry)(?:$|[/@_.-])/i.test(
    specifier,
  );
}

function unresolvedWebTransportReference(root, file, reference) {
  if (!reference?.dynamic || reference.known !== false) return false;
  const specifier = reference.text.replaceAll("\\", "/");
  if (/^(?:@\/|apps\/web\/src\/)api\/_transport(?:\/|$)/.test(specifier)) return true;
  if (!/^\.\.?\//.test(specifier)) return false;
  const resolved = path.resolve(path.dirname(file), specifier.replaceAll("\u0000", "__unknown__"));
  return display(root, resolved).startsWith("apps/web/src/api/_transport/");
}

function transportViolation(root, layer, file, target, node, reference) {
  const targetPath = target ? display(root, target) : undefined;
  if (!targetPath?.startsWith("apps/web/src/api/_transport/") && !unresolvedWebTransportReference(root, file, reference)) return undefined;
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

function transportRuntimeViolation(root, file, target) {
  if (!target) return undefined;
  const sourcePath = display(root, file);
  const targetPath = display(root, target);
  if (!sourcePath.startsWith("apps/web/src/api/_transport/")
    || !targetPath.startsWith("apps/web/src/api/_transport/")) return undefined;
  const sourceIsServer = /\.server\.[cm]?tsx?$/.test(sourcePath);
  const targetIsServer = /\.server\.[cm]?tsx?$/.test(targetPath);
  const targetIsBrowser = targetPath.endsWith("/browser-request.ts");
  if (!sourceIsServer && targetIsServer) {
    return "client-safe transport는 server 전용 transport를 import 또는 re-export할 수 없습니다.";
  }
  if (sourceIsServer && targetIsBrowser) {
    return "server transport는 browser 전용 request entry를 import 또는 re-export할 수 없습니다.";
  }
  return undefined;
}

// 공개 진입점은 모든 finding을 먼저 계산한 뒤 exact legacy baseline과 비교한다.
// 신규 위반은 예외로 흡수하지 않으며, 기존 fingerprint의 삭제만 허용하는 것이 반환 계약이다.
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
    const fingerprintEvidence = sourceFingerprintEvidence(normalized);
    if (physicalLineCount(normalized) > MAX_SOURCE_LINES) add(findings, root, WEB_BOUNDARY_RULES.SOURCE_FILE_SIZE, file, "SourceFile", sourceFile, `${MAX_SOURCE_LINES}줄을 넘는 source file은 책임 분리 또는 reviewed waiver가 필요합니다.`, undefined, fingerprintEvidence);
    if (isRouteLoadingPath(root, file) && !routeLoadingReturnsSingleScreenSkeleton(sourceFile)) add(findings, root, WEB_BOUNDARY_RULES.ROUTE_LOADING_BOUNDARY, file, "SourceFile", sourceFile, "loading.tsx는 sibling ScreenSkeleton 하나만 반환해야 합니다.", undefined, fingerprintEvidence);
    if (isLegacyPageContainerPath(root, file) && /\bisLoading\b/.test(normalized)) add(findings, root, WEB_BOUNDARY_RULES.PAGE_CONTAINER_LOADING_STATE, file, "SourceFile", sourceFile, "범용 PageContainer가 loading UI를 소유하면 화면별 skeleton geometry가 분리됩니다.", undefined, fingerprintEvidence);
    const nonblank = fingerprintEvidence.split("\n").filter((line) => line.trim()).length;
    if (nonblank >= MIN_DUPLICATE_NONBLANK_LINES && Buffer.byteLength(fingerprintEvidence) >= MIN_DUPLICATE_BYTES) {
      const key = sha256(fingerprintEvidence);
      const candidate = duplicates.get(key) ?? { evidence: fingerprintEvidence, members: [] };
      candidate.members.push(display(root, file));
      duplicates.set(key, candidate);
    }
    const layer = sourceLayer(file);
    const displayPath = display(root, file);
    if (hasUseCacheDirective(sourceFile)) {
      if (!isCacheOwnerPath(displayPath)) add(findings, root, WEB_BOUNDARY_RULES.USE_CACHE_PLACEMENT, file, "SourceFile", sourceFile, "use cache는 api/<resource>/server.ts의 read 함수에만 허용합니다.", undefined, fingerprintEvidence);
      if (usesRequestScopedInput(sourceFile)) add(findings, root, WEB_BOUNDARY_RULES.USE_CACHE_USER_DATA, file, "SourceFile", sourceFile, "use cache를 담은 파일은 cookies·headers 같은 요청별 입력을 읽을 수 없습니다.", undefined, fingerprintEvidence);
    }
    if (isClientDomainCalculationPath(displayPath)) for (const statement of exportedRuntimeStatements(sourceFile)) add(findings, root, WEB_BOUNDARY_RULES.CLIENT_DOMAIN_CALCULATION, file, statement, sourceFile, `legacy client 업무 계산(${exportedNames(statement).join(", ")})은 Server 계약 응답으로 대체한 뒤 삭제해야 합니다.`);
    if (isLegacyHooksPath(displayPath)) add(findings, root, WEB_BOUNDARY_RULES.LEGACY_HOOKS_DIRECTORY, file, "SourceFile", sourceFile, "hooks/ 디렉터리는 신규 파일을 받지 않습니다. generic hook은 shared/lib/hooks, 그 외는 소비 slice 내부에 둡니다.", undefined, fingerprintEvidence);
    if (isLegacyLibPath(displayPath)) add(findings, root, WEB_BOUNDARY_RULES.LEGACY_LIB_DIRECTORY, file, "SourceFile", sourceFile, "lib/ 디렉터리는 신규 파일을 받지 않습니다. generic helper는 shared/lib, 업무 값은 Server 계약 응답에 둡니다.", undefined, fingerprintEvidence);
    if (sourceFile.statements.some((statement) => ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression) && statement.expression.text === "use client") && /\/(?:page|layout)\.[cm]?tsx?$/.test(file.replaceAll("\\", "/"))) add(findings, root, WEB_BOUNDARY_RULES.ROUTE_CLIENT_COMPONENT, file, "SourceFile", sourceFile, "page.tsx와 layout.tsx는 Server Component를 기본으로 유지해야 합니다.", undefined, fingerprintEvidence);
    if (layer?.layer === "api") for (const declaration of exportedManualDtos(root, checker, sourceFile)) {
      const declarationFile = declaration.getSourceFile();
      const key = `${declarationFile.fileName}\0${declaration.getStart(declarationFile)}`;
      if (!manualDeclarations.has(key)) {
        manualDeclarations.add(key);
        add(findings, root, WEB_BOUNDARY_RULES.MANUAL_API_RESPONSE, declarationFile.fileName, declaration, declarationFile, "src/api의 public response는 수동 선언이 아닌 contract-inferred type이어야 합니다.");
      }
    }
    for (const crossing of clientValueExportCrossings(checker, sourceFile, source)) add(findings, root, WEB_BOUNDARY_RULES.CLIENT_VALUE_EXPORT_IMPORT, file, crossing.statement, sourceFile, `'use client' 모듈의 컴포넌트가 아닌 값(${crossing.names.join(", ")})을 서버 모듈이 import하면 client reference로 바뀝니다. 값은 _model/** 같은 지시자 없는 모듈로 옮기세요.`);
    const visit = (node) => {
      const moduleReference = reference(checker, node);
      if (moduleReference) {
        const target = moduleReference.known === false ? undefined : resolveModule(moduleReference.text, sourceFile, options);
        const targetLayer = target ? sourceLayer(target) : undefined;
        if (isCanonicalLayerPath(displayPath) && moduleReference.known !== false && isLegacyDirectoryReference(moduleReference.text, target ? display(root, target) : undefined)) add(findings, root, WEB_BOUNDARY_RULES.LEGACY_IMPORT, file, node, sourceFile, "신규 층은 legacy components·hooks·lib·config·types와 legacy route-private module(app/dashboard·welcome·s)을 import 또는 re-export할 수 없습니다.");
        // 의존 방향은 app → routing이다. routing이 route-private legacy builder를 re-export하는 shim은 동결된
        // legacy consumer 때문에만 남으며 삭제 전용 ledger로 추적한다.
        if (displayPath.startsWith("apps/web/src/routing/") && target && display(root, target).startsWith("apps/web/src/app/")) add(findings, root, WEB_BOUNDARY_RULES.LEGACY_IDENTITY_ROUTE, file, node, sourceFile, "routing 층은 app route-private module을 import 또는 re-export할 수 없습니다.");
        if (layer?.layer === "shell" && targetLayer && ["api", "capabilities"].includes(targetLayer.layer)) add(findings, root, WEB_BOUNDARY_RULES.SHELL_BOUNDARY_IMPORT, file, node, sourceFile, "shell은 API resource나 capability를 import 또는 re-export할 수 없습니다.");
        if (layer?.layer === "capabilities" && targetLayer?.layer === "capabilities" && targetLayer.slice !== layer.slice && !/\/index\.[cm]?tsx?$/.test(target ?? "")) add(findings, root, WEB_BOUNDARY_RULES.CAPABILITY_INTERNAL_IMPORT, file, node, sourceFile, "capability 간에는 상대 capability의 public index만 사용할 수 있습니다.");
        if (layer?.layer === "api" && layer.slice && layer.slice !== "_transport" && targetLayer?.layer === "api" && targetLayer.slice && targetLayer.slice !== "_transport" && targetLayer.slice !== layer.slice) add(findings, root, WEB_BOUNDARY_RULES.API_RESOURCE_CROSS_IMPORT, file, node, sourceFile, "API resource는 다른 resource를 직접 import 또는 re-export할 수 없습니다.");
        if (targetLayer?.layer === "api" && targetLayer.slice && targetLayer.slice !== "_transport" && !isPublicApiEntry(target) && !(layer?.layer === "api" && layer.slice === targetLayer.slice)) add(findings, root, WEB_BOUNDARY_RULES.WEB_API_DEEP_IMPORT, file, node, sourceFile, "external consumer는 API resource의 index.ts 또는 server.ts public entry만 사용할 수 있습니다.");
        const violation = transportViolation(root, layer, file, target, node, moduleReference);
        if (violation) add(findings, root, WEB_BOUNDARY_RULES.RESOURCE_TRANSPORT_IMPORT, file, node, sourceFile, violation);
        const runtimeViolation = transportRuntimeViolation(root, file, target);
        if (runtimeViolation) add(findings, root, WEB_BOUNDARY_RULES.TRANSPORT_RUNTIME_CROSS_IMPORT, file, node, sourceFile, runtimeViolation);
        if (isSharedUiPath(root, file) && isSharedControlResponsibilityImport(moduleReference.text)) {
          add(findings, root, WEB_BOUNDARY_RULES.SHARED_CONTROL_RESPONSIBILITY, file, node, sourceFile, "shared UI control은 인증·권한·업무 telemetry를 직접 import할 수 없습니다.");
        }
      }
      if (isLegacyIdentityScope(displayPath) && ((ts.isStringLiteralLike(node) && !isModuleSpecifierLiteral(node) && isLegacyRouteLiteral(node.text)) || (ts.isTemplateExpression(node) && isLegacyRouteLiteral(node.head.text)))) add(findings, root, WEB_BOUNDARY_RULES.LEGACY_IDENTITY_ROUTE, file, node, sourceFile, "routing 층과 route builder는 legacy /dashboard identity route를 만들 수 없습니다.");
      if (isCanonicalMotionPath(root, file) && ts.isStringLiteralLike(node)) {
        const violations = motionClassViolations(node.text);
        if (violations.transitionAll) add(findings, root, WEB_BOUNDARY_RULES.MOTION_TRANSITION_ALL, file, node, sourceFile, "canonical UI는 transition-all 대신 전환할 속성을 명시해야 합니다.");
        if (violations.durationLiteral) add(findings, root, WEB_BOUNDARY_RULES.MOTION_DURATION_LITERAL, file, node, sourceFile, "canonical UI의 motion duration은 semantic CSS token을 사용해야 합니다.");
        if (!isButtonPrimitivePath(root, file) && violations.localPress) add(findings, root, WEB_BOUNDARY_RULES.MOTION_LOCAL_PRESS, file, node, sourceFile, "화면은 press transform을 직접 만들지 않고 shared control을 사용해야 합니다.");
      }
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "ENDPOINTS") add(findings, root, WEB_BOUNDARY_RULES.FRONTEND_ENDPOINTS_MIRROR, file, node, sourceFile, "frontend ENDPOINTS mirror는 canonical operation contract를 중복합니다.");
      let endpointRoot = node;
      while (endpointRoot.parent && (ts.isParenthesizedExpression(endpointRoot.parent) || ts.isAsExpression(endpointRoot.parent) || ts.isTypeAssertionExpression(endpointRoot.parent) || ts.isSatisfiesExpression(endpointRoot.parent) || ts.isNonNullExpression(endpointRoot.parent)) && endpointRoot.parent.expression === endpointRoot) endpointRoot = endpointRoot.parent;
      const nestedEndpointExpression = Boolean(endpointRoot.parent && (ts.isBinaryExpression(endpointRoot.parent) || (ts.isTemplateSpan(endpointRoot.parent) && endpointRoot.parent.expression === endpointRoot)));
      const endpointCandidate = (ts.isStringLiteralLike(node) || ts.isTemplateExpression(node) || ts.isBinaryExpression(node)) && !nestedEndpointExpression;
      const endpoint = endpointCandidate ? staticExpression(checker, node).text : undefined;
      if (endpoint !== undefined && !isEndpointAuthorityPath(root, file) && !isModuleSpecifierLiteral(node) && /\/api\/v\d+(?:\/|$)/.test(endpoint)) add(findings, root, WEB_BOUNDARY_RULES.API_ENDPOINT_LITERAL, file, node, sourceFile, "canonical /api/vN path literal은 operation contract 밖에서 중복할 수 없습니다.");
      // callable 조합의 문법 이름이 아니라 DOM symbol origin이 증명된 호출만 transport 위반으로 보고한다.
      if (!isTransportPath(file) && isGlobalFetchCall(checker, node)) add(findings, root, WEB_BOUNDARY_RULES.RAW_FETCH, file, node, sourceFile, "raw fetch는 src/api/_transport에서만 수행할 수 있습니다.");
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
