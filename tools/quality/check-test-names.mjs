import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const root = process.env.TEST_NAMES_ROOT
  ? path.resolve(process.env.TEST_NAMES_ROOT)
  : repositoryRoot;
const requireFromServer = createRequire(path.join(repositoryRoot, "apps", "server", "package.json"));
const ts = requireFromServer("typescript");
const pythonChecker = path.join(repositoryRoot, "tools", "quality", "check-python-test-names.py");
const excludedDirectories = new Set([
  ".git",
  ".next",
  ".turbo",
  ".venv",
  "__pycache__",
  "dist",
  "node_modules",
]);
const testBases = new Set(["describe", "test", "it"]);
const supportedModifiers = new Set(["only", "skip", "todo", "each"]);
const testModules = new Set(["bun:test", "node:test", "vitest", "@jest/globals"]);
const hangulSyllable = /[가-힣]/;

function walk(directory, predicate, collected = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(target, predicate, collected);
    else if (entry.isFile() && predicate(entry.name)) collected.push(target);
  }
  return collected;
}

function display(file) {
  return path.relative(root, file).replaceAll("\\", "/");
}

function scriptKind(file) {
  return file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

function unwrap(expression) {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isTypeAssertionExpression(current)
    || ts.isNonNullExpression(current)
    || ts.isSatisfiesExpression?.(current)
  ) {
    current = current.expression;
  }
  return current;
}

function cloneTarget(target) {
  return { base: target.base, modifiers: [...target.modifiers], boundEach: target.boundEach };
}

function resolveAliasExpression(expression, aliases, namespaces) {
  const current = unwrap(expression);
  if (ts.isIdentifier(current)) {
    const target = aliases.get(current.text);
    return target ? cloneTarget(target) : undefined;
  }
  if (ts.isPropertyAccessExpression(current)) {
    if (ts.isIdentifier(current.expression) && namespaces.has(current.expression.text) && testBases.has(current.name.text)) {
      return { base: current.name.text, modifiers: [], boundEach: false };
    }
    const target = resolveAliasExpression(current.expression, aliases, namespaces);
    if (!target || !supportedModifiers.has(current.name.text)) return undefined;
    target.modifiers.push(current.name.text);
    return target;
  }
  if (ts.isCallExpression(current)) {
    const target = resolveAliasExpression(current.expression, aliases, namespaces);
    if (!target || target.modifiers.at(-1) !== "each") return undefined;
    return { ...target, boundEach: true };
  }
  if (ts.isTaggedTemplateExpression(current)) {
    const target = resolveAliasExpression(current.tag, aliases, namespaces);
    if (!target || target.modifiers.at(-1) !== "each") return undefined;
    return { ...target, boundEach: true };
  }
  return undefined;
}

function containsKnownTestReference(node, aliases, namespaces) {
  let found = false;
  const visit = (current) => {
    if (found) return;
    if (ts.isPropertyAccessExpression(current)) {
      // `.test()`는 RegExp나 validator의 일반 메서드일 수 있으므로 receiver만 별칭 후보로 본다.
      visit(current.expression);
      return;
    }
    if (ts.isIdentifier(current) && (aliases.has(current.text) || namespaces.has(current.text))) {
      found = true;
      return;
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return found;
}

function lineOf(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function inspectTypeScript(file) {
  const sourceFile = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    scriptKind(file),
  );
  const aliases = new Map([...testBases].map((base) => [base, { base, modifiers: [], boundEach: false }]));
  const namespaces = new Set();
  const violations = [];
  let declarationCount = 0;

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (!testModules.has(statement.moduleSpecifier.text) || !statement.importClause) continue;
    const { name, namedBindings } = statement.importClause;
    if (name) aliases.set(name.text, { base: "test", modifiers: [], boundEach: false });
    if (namedBindings && ts.isNamespaceImport(namedBindings)) namespaces.add(namedBindings.name.text);
    if (namedBindings && ts.isNamedImports(namedBindings)) {
      for (const specifier of namedBindings.elements) {
        const imported = specifier.propertyName?.text ?? specifier.name.text;
        if (testBases.has(imported)) {
          aliases.set(specifier.name.text, { base: imported, modifiers: [], boundEach: false });
        }
      }
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    const collectAliases = (node) => {
      if (ts.isVariableDeclaration(node) && node.initializer) {
        const target = resolveAliasExpression(node.initializer, aliases, namespaces);
        if (target && ts.isIdentifier(node.name) && !aliases.has(node.name.text)) {
          aliases.set(node.name.text, target);
          changed = true;
        } else if (target && ts.isObjectBindingPattern(node.name)) {
          for (const element of node.name.elements) {
            const property = element.propertyName && ts.isIdentifier(element.propertyName)
              ? element.propertyName.text
              : ts.isIdentifier(element.name) ? element.name.text : undefined;
            if (!property || !supportedModifiers.has(property) || !ts.isIdentifier(element.name)) continue;
            if (!aliases.has(element.name.text)) {
              aliases.set(element.name.text, {
                base: target.base,
                modifiers: [...target.modifiers, property],
                boundEach: target.boundEach,
              });
              changed = true;
            }
          }
        }
      }
      ts.forEachChild(node, collectAliases);
    };
    collectAliases(sourceFile);
  }

  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.name)) {
      const target = resolveAliasExpression(node.initializer, aliases, namespaces);
      if (!target && containsKnownTestReference(node.initializer, aliases, namespaces)) {
        violations.push({
          file: display(file),
          line: lineOf(sourceFile, node),
          message: `지원하지 않는 간접 테스트 별칭입니다: ${node.name.text}`,
        });
      }
    }

    if (ts.isCallExpression(node)) {
      const target = resolveAliasExpression(node.expression, aliases, namespaces);
      if (target && !(target.modifiers.at(-1) === "each" && !target.boundEach)) {
        declarationCount += 1;
        const title = node.arguments[0];
        if (!title || (!ts.isStringLiteral(title) && !ts.isNoSubstitutionTemplateLiteral(title))) {
          violations.push({
            file: display(file),
            line: lineOf(sourceFile, node),
            message: "동적 테스트 제목은 허용하지 않습니다. 직접 문자열을 사용하세요.",
          });
        } else if (!hangulSyllable.test(title.text)) {
          violations.push({
            file: display(file),
            line: lineOf(sourceFile, title),
            message: `테스트 제목에 한글 음절이 없습니다: ${JSON.stringify(title.text)}`,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { declarationCount, violations };
}

function runPythonChecker() {
  const candidates = process.env.PYTHON
    ? [process.env.PYTHON]
    : process.platform === "win32" ? ["python", "python3"] : ["python3", "python"];
  for (const executable of candidates) {
    const result = spawnSync(executable, [pythonChecker, root], { encoding: "utf8" });
    if (result.error?.code === "ENOENT") continue;
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(result.stderr || `Python 검사기가 ${result.status}로 종료했습니다.`);
    return JSON.parse(result.stdout);
  }
  throw new Error("Python AST 검사기를 실행할 python/python3를 찾지 못했습니다.");
}

const typescriptFiles = walk(root, (name) => name.endsWith(".ts") || name.endsWith(".tsx"));
const typescriptResults = typescriptFiles.map(inspectTypeScript);
const pythonResult = runPythonChecker();
const violations = [
  ...typescriptResults.flatMap((result) => result.violations),
  ...pythonResult.violations,
].sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line);
const typescriptDeclarationCount = typescriptResults.reduce(
  (count, result) => count + result.declarationCount,
  0,
);

if (violations.length > 0) {
  console.error("한국어 테스트 명세 검사가 실패했습니다:");
  for (const violation of violations) {
    console.error(`- ${violation.file}:${violation.line} ${violation.message}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `한국어 테스트 명세 검사가 통과했습니다. TypeScript ${typescriptDeclarationCount}개, Python ${pythonResult.declarationCount}개`,
  );
}
