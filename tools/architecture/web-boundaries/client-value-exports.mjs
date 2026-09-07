/** @module 책임: 서버 모듈이 'use client' 모듈의 컴포넌트가 아닌 runtime export를 import하는 RSC 경계 위반을 찾는다. */
import path from "node:path";
import ts from "typescript";
import { unwrapExpression } from "./static-analysis.mjs";

// EAT-77: 서버 컴포넌트가 'use client' 모듈의 숫자 상수를 import하자 RSC 경계에서 그 값이 client
// reference 객체로 바뀌어 `Math.min(...)`이 NaN을 냈다. 컴포넌트는 client reference로 바뀌는 것이
// 목적이지만 상수·함수는 서버에서 값으로 쓰이므로 이 교차만 잡는다. 타입 import는 지워지므로 제외한다.
const COMPONENT_NAME = /^[A-Z](?=.*[a-z])[A-Za-z0-9]*$/;

function hasDirective(sourceFile, directive) {
  for (const statement of sourceFile.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteralLike(statement.expression)) return false;
    if (statement.expression.text === directive) return true;
  }
  return false;
}

export function isClientModule(sourceFile) {
  return hasDirective(sourceFile, "use client");
}

// `SelectPrimitive.Root`처럼 다른 컴포넌트를 PascalCase 이름에 다시 묶는 alias도 컴포넌트다.
function isComponentInitializer(initializer) {
  if (!initializer) return false;
  const value = unwrapExpression(initializer);
  return ts.isArrowFunction(value) || ts.isFunctionExpression(value) || ts.isCallExpression(value)
    || ts.isIdentifier(value) || ts.isPropertyAccessExpression(value);
}

// 컴포넌트 판정은 React 관례(PascalCase 이름 + 함수/클래스/`memo(...)` 같은 wrapper 호출)로 한다.
// `SHOWN_ROWS`처럼 소문자가 없는 이름이나 `useX`·`formatX` 같은 함수는 컴포넌트가 아니다.
function isComponentDeclaration(declaration) {
  if (ts.isFunctionDeclaration(declaration) || ts.isClassDeclaration(declaration)) {
    return declaration.name ? COMPONENT_NAME.test(declaration.name.text) : true;
  }
  if (ts.isVariableDeclaration(declaration)) {
    return ts.isIdentifier(declaration.name) && COMPONENT_NAME.test(declaration.name.text) && isComponentInitializer(declaration.initializer);
  }
  if (ts.isExportAssignment(declaration)) return isComponentInitializer(declaration.expression);
  return false;
}

function valueDeclaration(checker, symbol) {
  const resolved = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  if (!(resolved.flags & ts.SymbolFlags.Value)) return undefined;
  return resolved.valueDeclaration ?? resolved.declarations?.find((declaration) => !ts.isTypeAliasDeclaration(declaration) && !ts.isInterfaceDeclaration(declaration));
}

function isInsideRoot(file, sourceRoot) {
  const relative = path.relative(sourceRoot, path.resolve(file));
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function crossingValue(checker, symbol, sourceRoot) {
  if (!symbol) return undefined;
  const declaration = valueDeclaration(checker, symbol);
  if (!declaration) return undefined;
  const declarationFile = declaration.getSourceFile();
  if (!isInsideRoot(declarationFile.fileName, sourceRoot) || !isClientModule(declarationFile)) return undefined;
  if (isComponentDeclaration(declaration)) return undefined;
  return { name: symbol.name, file: declarationFile.fileName };
}

function moduleExports(checker, moduleSpecifier) {
  const moduleSymbol = checker.getSymbolAtLocation(moduleSpecifier);
  return moduleSymbol ? checker.getExportsOfModule(moduleSymbol) : [];
}

function importedSymbols(checker, statement) {
  if (ts.isImportDeclaration(statement)) {
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly) return [];
    const symbols = [];
    if (clause.name) symbols.push(checker.getSymbolAtLocation(clause.name));
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) if (!element.isTypeOnly) symbols.push(checker.getSymbolAtLocation(element.name));
    }
    // namespace import는 값 하나를 고를 수 없으므로 모듈의 runtime export 전체를 교차 후보로 본다.
    if (bindings && ts.isNamespaceImport(bindings)) symbols.push(...moduleExports(checker, statement.moduleSpecifier));
    return symbols;
  }
  // barrel의 `export { x } from './client'`는 그 자체로는 값을 쓰지 않아 해롭지 않다. 소비하는 서버 모듈의
  // import가 alias를 끝까지 따라가 client 선언에 닿으므로 위반은 소비 지점에서 잡힌다.
  return [];
}

/**
 * 서버 모듈(`'use client'` 지시자가 없는 모듈) 하나에서 'use client' 모듈의 컴포넌트가 아닌 runtime export를
 * 끌어오는 import 문과 그 이름 목록을 돌려준다. 호출자가 module 위치 규칙과 fingerprint를 맡는다.
 */
export function clientValueExportCrossings(checker, sourceFile, sourceRoot) {
  if (isClientModule(sourceFile)) return [];
  const root = path.resolve(sourceRoot);
  const crossings = [];
  for (const statement of sourceFile.statements) {
    const names = [];
    for (const symbol of importedSymbols(checker, statement)) {
      const crossing = crossingValue(checker, symbol, root);
      if (crossing && !names.includes(crossing.name)) names.push(crossing.name);
    }
    if (names.length) crossings.push({ statement, names });
  }
  return crossings;
}
