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
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isTemplateExpression(node)) return node.head.text;
  return undefined;
}

function add(findings, root, file, rule, reason) {
  findings.push({ path: normalized(root, file), rule, reason });
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
  for (const file of sourceFiles(root)) {
    const relative = normalized(root, file);
    if (/^apps\/web\/src\/app\/.+\/route\.[cm]?[jt]sx?$/.test(relative)) {
      add(findings, root, file, "next-public-route-handler", "공개 HTTP ingress는 기본적으로 Nest Server가 소유합니다.");
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
