/** @module 책임: Server와 Web endpoint가 공개 operation registry에서만 파생되는지 검사한다. */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const sourceExtensions = /\.[cm]?[jt]sx?$/i;
const ignoredPath = /(?:^|\/)(?:node_modules|dist|\.next|coverage|fixtures?|__tests?__)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$/i;
const routeDecorators = new Set(["Controller", "Delete", "Get", "Patch", "Post", "Put"]);

function normalized(root, file) {
  return path.relative(root, file).replaceAll("\\", "/");
}

function sourceFiles(root) {
  const files = [];
  const visit = (entry) => {
    if (!existsSync(entry)) return;
    const relative = normalized(root, entry);
    if (ignoredPath.test(relative)) return;
    if (statSync(entry).isDirectory()) {
      for (const child of readdirSync(entry)) visit(path.join(entry, child));
    } else if (sourceExtensions.test(entry)) files.push(entry);
  };
  for (const sourceRoot of ["apps/server/src", "apps/web/src", "packages/contracts/src"]) {
    visit(path.join(root, sourceRoot));
  }
  return files.toSorted();
}

function literalText(node) {
  if (!node) return undefined;
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isTemplateExpression(node)) return node.head.text;
  return undefined;
}

function add(findings, root, file, rule, reason) {
  findings.push({ path: normalized(root, file), rule, reason });
}

function objectProperty(node, name) {
  if (!node || !ts.isObjectLiteralExpression(node)) return undefined;
  for (const property of node.properties) {
    if (ts.isPropertyAssignment(property)
      && (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name))
      && property.name.text === name) return property.initializer;
  }
  return undefined;
}

// `pathParameter("id")`는 Next의 `[id]` 폴더가 된다. 정적으로 읽지 못하는 segment가 하나라도 있으면
// 예외를 만들지 않는다 — 읽지 못한 경로를 통과시키면 규칙이 아니라 구멍이 된다.
function routeDirectorySegments(definition) {
  const route = objectProperty(definition, "route");
  const resource = literalText(objectProperty(route, "resource"));
  const segments = objectProperty(route, "segments");
  if (resource === undefined || !segments || !ts.isArrayLiteralExpression(segments)) return undefined;
  const versioning = objectProperty(definition, "versioning");
  const kind = literalText(objectProperty(versioning, "kind"));
  const prefix = [];
  if (kind === "uri") {
    const uriPrefix = literalText(objectProperty(versioning, "prefix"));
    const version = literalText(objectProperty(versioning, "version"));
    if (uriPrefix === undefined || version === undefined) return undefined;
    prefix.push(uriPrefix, `v${version}`);
  } else if (kind !== "neutral") return undefined;
  const rendered = [];
  for (const element of segments.elements) {
    const staticSegment = literalText(element);
    if (staticSegment !== undefined) {
      rendered.push(staticSegment);
      continue;
    }
    const parameter = ts.isCallExpression(element) && ts.isIdentifier(element.expression)
      && element.expression.text === "pathParameter"
      ? literalText(element.arguments[0])
      : undefined;
    if (parameter === undefined) return undefined;
    rendered.push(`[${parameter}]`);
  }
  return [...prefix, resource, ...rendered];
}

/**
 * web `route.ts`의 예외는 손으로 적은 목록이 아니라 계약에서 파생한다(AGENTS 19, ADR 0036-6).
 * `implementationOwner: "web"` operation의 semantic route가 곧 허용되는 route handler 폴더이며,
 * 그 대응은 양방향이다 — 계약 없는 handler도, handler 없는 계약도 실패다.
 */
function webOwnedRouteDirectories(root, files) {
  const directories = new Map();
  for (const file of files) {
    if (!normalized(root, file).startsWith("packages/contracts/src/")) continue;
    const sourceFile = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    const visit = (node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
        && node.expression.text === "defineOperation"
        && literalText(objectProperty(node.arguments[0], "implementationOwner")) === "web") {
        const segments = routeDirectorySegments(node.arguments[0]);
        const operationId = literalText(objectProperty(node.arguments[0], "operationId")) ?? "(unknown)";
        if (segments) directories.set(`apps/web/src/app/${segments.join("/")}`, operationId);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return directories;
}

function nestDecoratorNames(sourceFile) {
  const names = new Map([...routeDecorators].map((name) => [name, name]));
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier)
      || statement.moduleSpecifier.text !== "@nestjs/common") continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      const imported = element.propertyName?.text ?? element.name.text;
      if (routeDecorators.has(imported)) names.set(element.name.text, imported);
    }
  }
  return names;
}

export function inspectHttpOperationBoundaries({ repoRoot }) {
  const root = path.resolve(repoRoot);
  const findings = [];
  const files = sourceFiles(root);
  const webOwnedDirectories = webOwnedRouteDirectories(root, files);
  const implementedDirectories = new Set();
  for (const file of files) {
    const relative = normalized(root, file);
    const routeHandler = /^(apps\/web\/src\/app\/.+)\/route\.[cm]?[jt]sx?$/.exec(relative);
    if (routeHandler) {
      if (webOwnedDirectories.has(routeHandler[1])) implementedDirectories.add(routeHandler[1]);
      else add(findings, root, file, "next-public-route-handler", "공개 HTTP ingress는 기본적으로 Nest Server가 소유합니다. web handler는 implementationOwner가 web인 operation의 semantic route와 정확히 대응해야 합니다.");
    }
    const sourceFile = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    const decoratorNames = nestDecoratorNames(sourceFile);
    const visit = (node) => {
      const text = literalText(node);
      if (text?.startsWith("/api/v") && /^\/api\/v[1-9][0-9]*(?:\/|$)/.test(text)) {
        add(findings, root, file, "canonical-api-literal", "canonical /api/vN 경로는 operation semantic definition에서만 파생해야 합니다.");
      }
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "ENDPOINTS") {
        add(findings, root, file, "frontend-endpoints-mirror", "Web ENDPOINTS mirror는 operation descriptor를 중복합니다.");
      }
      if (ts.isCallExpression(node) && ts.isDecorator(node.parent) && ts.isIdentifier(node.expression)
        && decoratorNames.has(node.expression.text) && literalText(node.arguments[0])) {
        add(findings, root, file, "manual-nest-route", `@${decoratorNames.get(node.expression.text)} 경로는 operation descriptor의 파생 field를 사용해야 합니다.`);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  for (const [directory, operationId] of webOwnedDirectories) {
    if (implementedDirectories.has(directory)) continue;
    add(findings, root, path.join(root, `${directory}/route.ts`), "web-operation-without-handler",
      `${operationId} operation이 web 소유인데 대응하는 route handler가 없습니다.`);
  }
  return findings.toSorted((left, right) => left.path.localeCompare(right.path) || left.rule.localeCompare(right.rule));
}

const directRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (directRun) {
  const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
  const findings = inspectHttpOperationBoundaries({ repoRoot });
  if (findings.length) {
    console.error("HTTP operation 경계 검사가 실패했습니다.");
    for (const finding of findings) console.error(`- ${finding.path} [${finding.rule}] ${finding.reason}`);
    process.exitCode = 1;
  } else {
    console.log("HTTP operation 경계 검사가 통과했습니다.");
  }
}
