import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const defaultRoot = fileURLToPath(new URL("../../", import.meta.url));
const dependencySections = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
const requiredDependencies = {
  dependencies: {
    "@eatbid/contracts": "workspace:*",
    "@tanstack/react-form": "1.33.5",
    "@tanstack/react-query": "5.102.8",
    "@tanstack/react-query-devtools": "5.102.8",
    next: "16.3.4",
    react: "19.2.8",
    "react-dom": "19.2.8",
    "server-only": "0.0.1",
    zod: "catalog:",
  },
  devDependencies: {
    "@happy-dom/global-registrator": "20.12.0",
    "@tailwindcss/postcss": "4.3.3",
    "@testing-library/react": "16.3.3",
    "@testing-library/user-event": "14.6.6",
    "@types/bun": "1.2.22",
    "babel-plugin-react-compiler": "1.0.0",
    "happy-dom": "20.12.0",
    tailwindcss: "4.3.3",
    typescript: "5.9.3",
  },
};

function readRequiredFile(file, failures) {
  if (!existsSync(file)) {
    failures.push(`필수 파일이 없습니다: ${file}`);
    return undefined;
  }
  return readFileSync(file, "utf8");
}

function readJson(file, failures) {
  const source = readRequiredFile(file, failures);
  if (source === undefined) return undefined;
  try {
    return JSON.parse(source);
  } catch (error) {
    failures.push(`${file} JSON을 읽을 수 없습니다: ${error.message}`);
    return undefined;
  }
}

function checkDependencies(webPackage, failures) {
  for (const [expectedSection, packages] of Object.entries(requiredDependencies)) {
    for (const [packageName, expectedVersion] of Object.entries(packages)) {
      const declarations = dependencySections
        .filter((section) => Object.hasOwn(webPackage[section] ?? {}, packageName))
        .map((section) => ({ section, version: webPackage[section][packageName] }));

      if (declarations.length !== 1) {
        failures.push(`${packageName}은 ${expectedSection}에 한 번만 선언해야 합니다.`);
        continue;
      }

      const [{ section, version }] = declarations;
      if (section !== expectedSection || version !== expectedVersion) {
        failures.push(
          `${packageName}은 ${expectedSection}에 exact ${expectedVersion}로 선언해야 합니다. 현재: ${section} ${version}`,
        );
      }
    }
  }

  for (const section of dependencySections) {
    if (Object.hasOwn(webPackage[section] ?? {}, "kbar")) {
      failures.push(`kbar는 Web ${section}에 남을 수 없습니다.`);
    }
  }
}

function unquote(value) {
  return value.trim().replace(/^(["'])(.*)\1$/, "$2");
}

function checkZodCatalog(workspaceSource, failures) {
  const catalog = /^catalog:\s*\r?\n((?:^[ \t]+.*(?:\r?\n|$))*)/m.exec(workspaceSource)?.[1] ?? "";
  const zodVersion = /^\s+zod:\s*([^#\r\n]+)/m.exec(catalog)?.[1];
  if (!zodVersion || unquote(zodVersion) !== "4.5.4") {
    failures.push(`root catalog의 zod는 exact 4.5.4여야 합니다.`);
  }
}

function propertyName(property) {
  if (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) return property.name.text;
  return undefined;
}

function directProperty(object, name) {
  return object.properties.find(
    (property) => ts.isPropertyAssignment(property) && propertyName(property) === name,
  );
}

function configObjects(sourceFile) {
  const objects = [];
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && ts.isObjectLiteralExpression(node.initializer)) {
      const typeText = node.type?.getText(sourceFile) ?? "";
      if (/config/i.test(node.name.text) || typeText.includes("NextConfig")) objects.push(node.initializer);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return objects;
}

function isTrue(property) {
  return property && property.initializer.kind === ts.SyntaxKind.TrueKeyword;
}

function isAnnotationCompiler(property) {
  if (!property || !ts.isObjectLiteralExpression(property.initializer)) return false;
  const mode = directProperty(property.initializer, "compilationMode");
  return Boolean(mode && ts.isStringLiteral(mode.initializer) && mode.initializer.text === "annotation");
}

function hasProperty(sourceFile, name) {
  let found = false;
  function visit(node) {
    if (ts.isPropertyAssignment(node) && propertyName(node) === name) found = true;
    if (!found) ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return found;
}

function hasNamedImport(sourceFile, moduleName, importedName) {
  return sourceFile.statements.some((statement) =>
    ts.isImportDeclaration(statement)
    && ts.isStringLiteral(statement.moduleSpecifier)
    && statement.moduleSpecifier.text === moduleName
    && statement.importClause?.namedBindings
    && ts.isNamedImports(statement.importClause.namedBindings)
    && statement.importClause.namedBindings.elements.some((element) =>
      !element.propertyName && element.name.text === importedName));
}

function containsCall(node, identifier) {
  let found = false;
  function visit(current) {
    if (ts.isCallExpression(current) && ts.isIdentifier(current.expression)
      && current.expression.text === identifier) found = true;
    if (!found) ts.forEachChild(current, visit);
  }
  visit(node);
  return found;
}

function checkNextConfig(configSource, failures, label = "Next 최상위 config") {
  const sourceFile = ts.createSourceFile("next.config.ts", configSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const candidates = configObjects(sourceFile);
  const hasTypedRoutes = candidates.some((object) => isTrue(directProperty(object, "typedRoutes")));
  const hasAnnotationMode = candidates.some((object) => isAnnotationCompiler(directProperty(object, "reactCompiler")));
  const hasApiRewrite = hasNamedImport(sourceFile, "./config/api-rewrites", "createApiRewrites")
    && candidates.some((object) => {
      const rewrites = directProperty(object, "rewrites");
      return rewrites ? containsCall(rewrites.initializer, "createApiRewrites") : false;
    });

  if (!hasTypedRoutes) failures.push(`${label}에 typedRoutes: true가 필요합니다.`);
  if (!hasAnnotationMode) {
    failures.push(`${label}의 reactCompiler에 compilationMode: 'annotation'이 필요합니다.`);
  }
  if (!hasApiRewrite) failures.push(`${label}의 rewrites는 createApiRewrites를 호출해야 합니다.`);
  if (hasProperty(sourceFile, "cacheComponents")) {
    failures.push(`${label}에 검토 전 cacheComponents를 설정하지 않습니다.`);
  }
  if (hasProperty(sourceFile, "turbopackRustReactCompiler")) {
    failures.push(`${label}에 검토 전 turbopackRustReactCompiler를 설정하지 않습니다.`);
  }
}

export function checkWebRuntime({ repositoryRoot = defaultRoot } = {}) {
  const root = path.resolve(repositoryRoot);
  const webRoot = path.join(root, "apps", "web");
  const failures = [];
  const webPackage = readJson(path.join(webRoot, "package.json"), failures);
  const workspaceSource = readRequiredFile(path.join(root, "pnpm-workspace.yaml"), failures);
  const configSource = readRequiredFile(path.join(webRoot, "next.config.ts"), failures);
  const cleanupConfigSource = readRequiredFile(
    path.join(webRoot, "scripts", "cleanup-templates", "sentry", "next.config.ts"),
    failures,
  );

  if (webPackage) {
    checkDependencies(webPackage, failures);
    if (webPackage.scripts?.typecheck !== "next typegen && tsc --noEmit") {
      failures.push(`Web typecheck는 next typegen && tsc --noEmit이어야 합니다.`);
    }
  }
  if (workspaceSource !== undefined) checkZodCatalog(workspaceSource, failures);
  if (configSource !== undefined) checkNextConfig(configSource, failures);
  if (cleanupConfigSource !== undefined) checkNextConfig(cleanupConfigSource, failures, "cleanup template");
  return failures;
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const failures = checkWebRuntime({ repositoryRoot: process.env.WEB_RUNTIME_ROOT ?? defaultRoot });
  if (failures.length > 0) {
    console.error("Web 런타임 정책 검사가 실패했습니다.");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
  } else {
    console.log("Web 런타임 정책 검사가 통과했습니다.");
  }
}
