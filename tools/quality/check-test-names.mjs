/** @module 책임: 이 체크아웃의 TypeScript·Python 테스트 제목이 한국어 행위 명세인지 AST로 검사하고 위반을 CLI 실패로 보고한다. */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { changedScope, describeScope } from "../git/changed-paths.mjs";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const root = process.env.TEST_NAMES_ROOT
  ? path.resolve(process.env.TEST_NAMES_ROOT)
  : repositoryRoot;
// 규칙 자체는 예외가 없으므로 기본은 전체 검사다. 드라이버가 변경 경로를 넘기거나 `--changed`를 준 경우에만
// 그 파일로 좁혀 pre-commit 시간을 줄인다. 기준을 못 찾으면 좁히지 않고 전체를 본다.
const scope = changedScope({ repoRoot: root, defaultMode: "all" });
const scopedPaths = scope.mode === "changed" ? scope.paths : undefined;
const requireFromServer = createRequire(path.join(repositoryRoot, "apps", "server", "package.json"));
const ts = requireFromServer("typescript");
const pythonChecker = path.join(repositoryRoot, "tools", "quality", "check-python-test-names.py");
// `.claude/worktrees/**`는 병렬 에이전트의 worktree라 스캔 도중 파일이 사라진다. 검사 대상은 이 체크아웃뿐이다.
const excludedDirectories = new Set([
  ".claude",
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
const genericKoreanTitle = /^(?:(?:테스트|동작|행위|계약|범위|상태|결과|조건|내용|기능|값)(?:을|를|은|는|이|가)?\s*)?(?:검증|확인|검사)(?:한다)?[.!]?$/;
const genericKoreanScope = /^(?:검증 범위를 정의한다|테스트 범위를 정의한다)$/;
const englishBehaviorWords = new Set([
  "accepts", "allows", "blocks", "builds", "checks", "creates", "emits", "fails",
  "generates", "has", "is", "keeps", "maps", "parses", "preserves", "reads", "rejects",
  "requires", "returns", "runs", "throws", "uses", "validates", "verifies", "writes",
]);
const koreanBehaviorPredicate = /다[.!]?$/;
const javascriptExtensions = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"]);

function readEntries(directory) {
  try {
    return readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function walk(directory, predicate, collected = []) {
  for (const entry of readEntries(directory)) {
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
  switch (path.extname(file)) {
    case ".tsx": return ts.ScriptKind.TSX;
    case ".jsx": return ts.ScriptKind.JSX;
    case ".js":
    case ".mjs":
    case ".cjs": return ts.ScriptKind.JS;
    default: return ts.ScriptKind.TS;
  }
}

function unwrap(expression) {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isTypeAssertionExpression(current)
    || ts.isNonNullExpression(current)
    || ts.isSatisfiesExpression?.(current)
    || ts.isAwaitExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function cloneTarget(target) {
  return target.kind === "namespace"
    ? { kind: "namespace" }
    : {
      kind: "test",
      base: target.base,
      modifiers: [...target.modifiers],
      boundEach: target.boundEach,
    };
}

function memberName(expression) {
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (!ts.isElementAccessExpression(expression) || !expression.argumentExpression) return undefined;
  const argument = unwrap(expression.argumentExpression);
  return ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)
    ? argument.text
    : undefined;
}

function moduleNamespace(expression, checker) {
  const current = unwrap(expression);
  if (!ts.isCallExpression(current) || current.arguments.length !== 1) return undefined;
  const moduleName = unwrap(current.arguments[0]);
  if (!ts.isStringLiteral(moduleName) || !testModules.has(moduleName.text)) return undefined;
  if (current.expression.kind === ts.SyntaxKind.ImportKeyword) return { kind: "namespace" };
  if (!ts.isIdentifier(current.expression) || current.expression.text !== "require") return undefined;
  const requireSymbol = checker.getSymbolAtLocation(current.expression);
  const locallyShadowed = requireSymbol?.declarations?.some(
    (declaration) => declaration.getSourceFile() === current.getSourceFile(),
  ) ?? false;
  return locallyShadowed ? undefined : { kind: "namespace" };
}

function resolveAliasExpression(expression, aliases, checker) {
  const current = unwrap(expression);
  const importedNamespace = moduleNamespace(current, checker);
  if (importedNamespace) return importedNamespace;
  if (ts.isIdentifier(current)) {
    const symbol = checker.getSymbolAtLocation(current);
    const target = symbol ? aliases.get(symbol) : undefined;
    if (target) return cloneTarget(target);
    return symbol === undefined && testBases.has(current.text)
      ? { kind: "test", base: current.text, modifiers: [], boundEach: false }
      : undefined;
  }
  if (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
    const property = memberName(current);
    if (!property) return undefined;
    const receiver = resolveAliasExpression(current.expression, aliases, checker);
    if (!receiver) return undefined;
    if (receiver.kind === "namespace" && testBases.has(property)) {
      return { kind: "test", base: property, modifiers: [], boundEach: false };
    }
    if (receiver.kind !== "test" || !supportedModifiers.has(property)) return undefined;
    receiver.modifiers.push(property);
    return receiver;
  }
  if (ts.isCallExpression(current)) {
    const target = resolveAliasExpression(current.expression, aliases, checker);
    if (!target || target.kind !== "test" || target.modifiers.at(-1) !== "each") return undefined;
    return { ...target, boundEach: true };
  }
  if (ts.isTaggedTemplateExpression(current)) {
    const target = resolveAliasExpression(current.tag, aliases, checker);
    if (!target || target.kind !== "test" || target.modifiers.at(-1) !== "each") return undefined;
    return { ...target, boundEach: true };
  }
  return undefined;
}

function containsKnownTestReference(node, aliases, checker) {
  let found = false;
  const visit = (current) => {
    if (found) return;
    if (moduleNamespace(current, checker)) {
      found = true;
      return;
    }
    if (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
      // `.test()`는 RegExp나 validator의 일반 메서드일 수 있으므로 receiver만 별칭 후보로 본다.
      visit(current.expression);
      return;
    }
    if (ts.isIdentifier(current) && resolveAliasExpression(current, aliases, checker)) {
      found = true;
      return;
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return found;
}

function bindTarget(name, sourceTarget, aliases, checker) {
  if (ts.isIdentifier(name)) {
    const symbol = checker.getSymbolAtLocation(name);
    if (!symbol) return;
    if (sourceTarget) aliases.set(symbol, cloneTarget(sourceTarget));
    else aliases.delete(symbol);
    return;
  }
  if (!ts.isObjectBindingPattern(name)) return;
  for (const element of name.elements) {
    if (element.dotDotDotToken) {
      bindTarget(element.name, sourceTarget, aliases, checker);
      continue;
    }
    const property = element.propertyName && (ts.isIdentifier(element.propertyName) || ts.isStringLiteral(element.propertyName))
      ? element.propertyName.text
      : ts.isIdentifier(element.name) ? element.name.text : undefined;
    const target = property ? targetMember(sourceTarget, property) : undefined;
    bindTarget(element.name, target, aliases, checker);
  }
}

function targetMember(sourceTarget, property) {
  if (sourceTarget?.kind === "namespace" && testBases.has(property)) {
    return { kind: "test", base: property, modifiers: [], boundEach: false };
  }
  if (sourceTarget?.kind === "test" && supportedModifiers.has(property)) {
    const target = cloneTarget(sourceTarget);
    target.modifiers.push(property);
    return target;
  }
  return undefined;
}

function propertyNameText(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return undefined;
}

function bindAssignmentTarget(pattern, sourceTarget, aliases, checker) {
  if (ts.isIdentifier(pattern)) {
    bindTarget(pattern, sourceTarget, aliases, checker);
    return true;
  }
  if (!ts.isObjectLiteralExpression(pattern)) return false;
  let supported = true;
  for (const property of pattern.properties) {
    if (ts.isSpreadAssignment(property)) {
      if (!bindAssignmentTarget(property.expression, sourceTarget, aliases, checker)) supported = false;
      continue;
    }
    if (ts.isShorthandPropertyAssignment(property)) {
      bindTarget(property.name, targetMember(sourceTarget, property.name.text), aliases, checker);
      continue;
    }
    if (ts.isPropertyAssignment(property)) {
      const name = propertyNameText(property.name);
      if (!name || !bindAssignmentTarget(
        property.initializer,
        targetMember(sourceTarget, name),
        aliases,
        checker,
      )) supported = false;
      continue;
    }
    supported = false;
  }
  return supported;
}

function patternHasKnownAlias(pattern, aliases, checker) {
  let found = false;
  const visit = (node) => {
    if (found) return;
    if (ts.isIdentifier(node)) {
      const symbol = checker.getSymbolAtLocation(node);
      if (symbol && aliases.has(symbol)) found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(pattern);
  return found;
}

function isNonDominatingWrite(node) {
  let current = node.parent;
  while (current && !ts.isSourceFile(current)) {
    if (ts.isFunctionLike(current)) return true;
    if (ts.isIfStatement(current)
      || ts.isConditionalExpression(current)
      || ts.isSwitchStatement(current)
      || ts.isCaseBlock(current)
      || ts.isForStatement(current)
      || ts.isForInStatement(current)
      || ts.isForOfStatement(current)
      || ts.isWhileStatement(current)
      || ts.isDoStatement(current)
      || ts.isTryStatement(current)) return true;
    if (ts.isBinaryExpression(current)
      && (current.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
        || current.operatorToken.kind === ts.SyntaxKind.BarBarToken
        || current.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
      && current.right === node) return true;
    node = current;
    current = current.parent;
  }
  return false;
}

function hasEnglishBehaviorPredicate(value) {
  return (value.match(/[A-Za-z]+/g) ?? []).some((word) => englishBehaviorWords.has(word.toLowerCase()));
}

function hasLatinClause(value) {
  return /[A-Za-z]{2,}/.test(value);
}

function isMeaningfulKoreanTitle(title, base) {
  if (!hangulSyllable.test(title)) return false;
  const separator = title.match(/\s[—–-]\s/);
  const behavior = separator ? title.slice(0, separator.index).trim() : title.trim();
  const trailingClause = separator ? title.slice(separator.index + separator[0].length).trim() : "";
  if (genericKoreanTitle.test(behavior) || genericKoreanScope.test(behavior)) return false;
  if (base === "describe") return true;
  const hangulCount = [...behavior].filter((character) => hangulSyllable.test(character)).length;
  return hangulCount >= 2
    && !hasEnglishBehaviorPredicate(behavior)
    && (koreanBehaviorPredicate.test(behavior)
      || (!hasLatinClause(trailingClause) && !hasEnglishBehaviorPredicate(title)));
}

function lineOf(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function inspectTypeScript(sourceFile, checker) {
  const file = sourceFile.fileName;
  const aliases = new Map();
  const violations = [];
  let declarationCount = 0;

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (!testModules.has(statement.moduleSpecifier.text) || !statement.importClause) continue;
    const { name, namedBindings } = statement.importClause;
    if (name) bindTarget(name, { kind: "test", base: "test", modifiers: [], boundEach: false }, aliases, checker);
    if (namedBindings && ts.isNamespaceImport(namedBindings)) {
      bindTarget(namedBindings.name, { kind: "namespace" }, aliases, checker);
    }
    if (namedBindings && ts.isNamedImports(namedBindings)) {
      for (const specifier of namedBindings.elements) {
        const imported = specifier.propertyName?.text ?? specifier.name.text;
        if (testBases.has(imported)) {
          bindTarget(
            specifier.name,
            { kind: "test", base: imported, modifiers: [], boundEach: false },
            aliases,
            checker,
          );
        }
      }
    }
  }

  const visit = (node) => {
    if (ts.isVariableDeclaration(node)) {
      const target = node.initializer
        ? resolveAliasExpression(node.initializer, aliases, checker)
        : undefined;
      bindTarget(node.name, target, aliases, checker);
      if (node.initializer && !target && containsKnownTestReference(node.initializer, aliases, checker)) {
        violations.push({
          file: display(file),
          line: lineOf(sourceFile, node),
          message: `지원하지 않는 간접 테스트 별칭입니다: ${node.name.getText(sourceFile)}`,
        });
      }
    }

    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && (ts.isIdentifier(node.left) || ts.isObjectLiteralExpression(node.left)
        || ts.isArrayLiteralExpression(node.left))) {
      const target = resolveAliasExpression(node.right, aliases, checker);
      const containsTestReference = containsKnownTestReference(node.right, aliases, checker);
      const ambiguousWrite = isNonDominatingWrite(node)
        && (patternHasKnownAlias(node.left, aliases, checker) || Boolean(target) || containsTestReference);
      const supportedPattern = ts.isIdentifier(node.left) || ts.isObjectLiteralExpression(node.left);
      if (ambiguousWrite) {
        violations.push({
          file: display(file),
          line: lineOf(sourceFile, node),
          message: `조건부 테스트 별칭 재할당은 허용하지 않습니다: ${node.left.getText(sourceFile)}`,
        });
        if (target) bindAssignmentTarget(node.left, target, aliases, checker);
      } else if (supportedPattern) {
        bindAssignmentTarget(node.left, target, aliases, checker);
      }
      if ((!supportedPattern || !target) && containsTestReference && !ambiguousWrite) {
        violations.push({
          file: display(file),
          line: lineOf(sourceFile, node),
          message: `지원하지 않는 간접 테스트 별칭입니다: ${node.left.getText(sourceFile)}`,
        });
      }
    }

    if (ts.isCallExpression(node)) {
      const target = resolveAliasExpression(node.expression, aliases, checker);
      if (target?.kind === "test" && !(target.modifiers.at(-1) === "each" && !target.boundEach)) {
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
        } else if (!isMeaningfulKoreanTitle(title.text, target.base)) {
          violations.push({
            file: display(file),
            line: lineOf(sourceFile, title),
            message: `구체적인 한국어 행위가 없는 일반 장식 제목입니다: ${JSON.stringify(title.text)}`,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { declarationCount, violations };
}

function runPythonChecker(pythonPaths) {
  if (pythonPaths && pythonPaths.length === 0) return { declarationCount: 0, violations: [] };
  const candidates = process.env.PYTHON
    ? [process.env.PYTHON]
    : process.platform === "win32" ? ["python", "python3"] : ["python3", "python"];
  for (const executable of candidates) {
    const result = spawnSync(executable, [pythonChecker, root, ...(pythonPaths ? ["--paths-from-stdin"] : [])], {
      encoding: "utf8",
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
      input: pythonPaths ? JSON.stringify({ paths: pythonPaths }) : undefined,
    });
    if (result.error?.code === "ENOENT") continue;
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(result.stderr || `Python 검사기가 ${result.status}로 종료했습니다.`);
    return JSON.parse(result.stdout);
  }
  throw new Error("Python AST 검사기를 실행할 python/python3를 찾지 못했습니다.");
}

const typescriptFiles = walk(root, (name) => javascriptExtensions.has(path.extname(name)))
  .filter((file) => !scopedPaths || scopedPaths.has(display(file)));
const pythonPaths = scopedPaths ? [...scopedPaths].filter((item) => item.endsWith(".py")).sort() : undefined;
const compilerOptions = {
  allowJs: true,
  checkJs: false,
  module: ts.ModuleKind.Preserve,
  noLib: true,
  noResolve: true,
  target: ts.ScriptTarget.Latest,
  types: [],
};
const compilerHost = ts.createCompilerHost(compilerOptions);
compilerHost.getSourceFile = (file, languageVersion) => {
  try {
    return ts.createSourceFile(file, readFileSync(file, "utf8"), languageVersion, true, scriptKind(file));
  } catch {
    return undefined;
  }
};
const program = ts.createProgram(typescriptFiles, compilerOptions, compilerHost);
const checker = program.getTypeChecker();
// 목록을 만든 뒤 사라진 파일은 program에 없다. 없는 파일을 검사하려 들지 않고 건너뛴다.
const typescriptResults = typescriptFiles
  .map((file) => program.getSourceFile(file))
  .filter((sourceFile) => sourceFile !== undefined)
  .map((sourceFile) => inspectTypeScript(sourceFile, checker));
const pythonResult = runPythonChecker(pythonPaths);
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
    `한국어 테스트 명세 검사가 통과했습니다. ${describeScope(scope)}, TypeScript ${typescriptDeclarationCount}개, Python ${pythonResult.declarationCount}개`,
  );
}
