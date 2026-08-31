import ts from "typescript";
import { staticPropertyName, unwrapExpression } from "./static-analysis.mjs";

// 이 모듈은 함수 이름을 나열하지 않고 Function.prototype의 호출 의미를 축약 해석한다.
// 판정의 끝점은 TypeScript가 확인한 DOM fetch symbol이며, local shadow나 임의 객체는 경계 밖이다.
const MAX_EXACT_DEPTH = 96;
const MAX_EVIDENCE_DEPTH = 1024;
const MAX_EVIDENCE_NODES = 4096;
const functionMethods = new Set(["apply", "bind", "call"]);
const otherValue = Object.freeze({ kind: "other" });
const unknownValue = Object.freeze({ kind: "unknown", possibleFetch: false });
const possibleFetchValue = Object.freeze({ kind: "unknown", possibleFetch: true });
const fetchValue = Object.freeze({ kind: "fetch" });

// alias를 실제 선언으로 접어야 local 이름과 lib 선언을 같은 기준으로 비교할 수 있다.
function resolvedSymbol(checker, node) {
  let symbol = checker.getSymbolAtLocation(node);
  if (symbol?.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
  return symbol;
}

// 전역 권위는 이름이 아니라 TypeScript 기본 lib의 정확한 symbol로 제한한다.
export function isDomLibrarySymbol(symbol, name) {
  return symbol?.getName() === name
    && symbol.declarations?.some((declaration) => declaration.getSourceFile().isDeclarationFile && /lib\.dom\.d\.ts$/.test(declaration.getSourceFile().fileName));
}

// bracket 접근도 receiver type에서 property symbol을 찾아 사용자 정의 call/bind/apply와 구분한다.
function propertySymbol(checker, node, name) {
  if (ts.isPropertyAccessExpression(node)) return resolvedSymbol(checker, node.name);
  return checker.getTypeAtLocation(node.expression).getProperty(name);
}

// Function intrinsic만 메타 호출 규칙을 적용한다. 같은 이름의 임의 객체 method는 해석하지 않는다.
function functionMethod(checker, node) {
  const current = unwrapExpression(node);
  if (!(ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current))) return undefined;
  const name = staticPropertyName(checker, current);
  if (!functionMethods.has(name)) return undefined;
  const symbol = propertySymbol(checker, current, name);
  return symbol?.declarations?.some((declaration) => /lib\.es5\.d\.ts$/.test(declaration.getSourceFile().fileName)) ? name : undefined;
}

function isKnownCallable(value) {
  return ["bound", "fetch", "intrinsic"].includes(value.kind) || Boolean(value.possibleFetch);
}

// window/globalThis 자체도 shadow될 수 있으므로 receiver와 fetch property 양쪽 symbol을 확인한다.
function isGlobalFetchReference(checker, node) {
  const expression = unwrapExpression(node);
  if (ts.isIdentifier(expression)) return isDomLibrarySymbol(resolvedSymbol(checker, expression), "fetch");
  if (!(ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) || staticPropertyName(checker, expression) !== "fetch") return false;
  const receiver = unwrapExpression(expression.expression);
  if (!ts.isIdentifier(receiver) || !["globalThis", "window"].includes(receiver.text)) return false;
  const property = propertySymbol(checker, expression, "fetch");
  return isDomLibrarySymbol(property, "fetch");
}

function intrinsicValue(method) {
  return { kind: "intrinsic", method };
}

function arrayValue(elements) {
  return { kind: "array", elements };
}

function boundValue(target, thisValue, args) {
  return { kind: "bound", target, thisValue, args };
}

function knownArgs(values) {
  return { known: true, values };
}

const unknownArgs = Object.freeze({ known: false, values: [] });

// exact 해석 한도를 넘으면 더 넓은 동일 의미 해석을 한 번 수행한다.
// 그 한도마저 넘은 경우에만 global fetch symbol 근거가 있는 callable을 fail closed로 취급한다.
function exhaustedValue(checker, node, state) {
  if (state.allowEvidenceFallback) {
    return evaluateValue(checker, node, {
      active: new Set(),
      allowEvidenceFallback: false,
      maxDepth: MAX_EVIDENCE_DEPTH,
    });
  }
  return hasGlobalFetchEvidence(checker, node) ? possibleFetchValue : unknownValue;
}

// 최후의 근거 탐색은 callable 의미에 관여하는 callee/receiver/meta-call 인자만 순회한다.
// 일반 함수의 데이터 인자에 fetch가 있다는 이유만으로 호출 origin으로 승격하지 않는다.
function hasGlobalFetchEvidence(checker, node) {
  const pending = [node];
  const seen = new Set();
  let visited = 0;
  while (pending.length && visited < MAX_EVIDENCE_NODES) {
    const current = unwrapExpression(pending.pop());
    if (!current || seen.has(current)) continue;
    seen.add(current);
    visited += 1;
    if (isGlobalFetchReference(checker, current)) return true;
    if (ts.isBinaryExpression(current) && current.operatorToken.kind === ts.SyntaxKind.CommaToken) pending.push(current.right);
    else if (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) pending.push(current.expression);
    else if (ts.isCallExpression(current)) {
      pending.push(current.expression);
      if (functionMethod(checker, unwrapExpression(current.expression))) pending.push(...current.arguments);
    } else if (ts.isArrayLiteralExpression(current)) pending.push(...current.elements);
  }
  return false;
}

// expression이 평가되어 돌려주는 callable 값만 추적한다. 내부에서 이미 실행된 fetch 효과는
// 별도 AST CallExpression 방문이 보고하므로 결과 origin과 섞어 중복 finding을 만들지 않는다.
function evaluateValue(checker, node, state, depth = 0) {
  if (!node) return otherValue;
  const current = unwrapExpression(node);
  if (depth > state.maxDepth) return exhaustedValue(checker, current, state);
  if (state.active.has(current)) return unknownValue;
  state.active.add(current);
  try {
    if (isGlobalFetchReference(checker, current)) return fetchValue;
    if (ts.isBinaryExpression(current) && current.operatorToken.kind === ts.SyntaxKind.CommaToken) return evaluateValue(checker, current.right, state, depth + 1);
    if (ts.isArrayLiteralExpression(current)) {
      if (current.elements.some(ts.isSpreadElement)) return arrayValue(undefined);
      return arrayValue(current.elements.map((element) => evaluateValue(checker, element, state, depth + 1)));
    }
    const reference = methodReference(checker, current, state, depth + 1);
    if (reference) return intrinsicValue(reference.method);
    if (ts.isCallExpression(current)) return analyzeCall(checker, current, state, depth + 1).result;
    return otherValue;
  } finally {
    state.active.delete(current);
  }
}

// bind 반환 type이 any로 소실돼도 receiver가 이미 검증된 callable이면 표준 Function method 의미를 유지한다.
// 반대로 임의 객체의 동명 method는 lib symbol도 callable receiver 근거도 없으므로 경계 밖이다.
function methodReference(checker, node, state, depth) {
  const current = unwrapExpression(node);
  if (!(ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current))) return undefined;
  const name = staticPropertyName(checker, current);
  if (!functionMethods.has(name)) return undefined;
  const receiver = evaluateValue(checker, current.expression, state, depth + 1);
  return functionMethod(checker, current) || isKnownCallable(receiver) ? { method: name, receiver } : undefined;
}

// property call은 receiver를 implicit this로 보존하고, 분리된 intrinsic 값은 this가 없는 호출로 둔다.
function callReference(checker, node, state, depth) {
  const current = unwrapExpression(node);
  const reference = methodReference(checker, current, state, depth + 1);
  if (reference) return { target: intrinsicValue(reference.method), thisValue: reference.receiver };
  return { target: evaluateValue(checker, current, state, depth + 1), thisValue: otherValue };
}

function combineArgs(left, right) {
  return left.known && right.known ? knownArgs([...left.values, ...right.values]) : unknownArgs;
}

function invocation(result = otherValue, invokesFetch = false) {
  return { result, invokesFetch };
}

// Function.prototype 의미를 한 곳에서 해석해 call/apply/bind 순서가 바뀌거나 중첩되어도 같은 규칙을 쓴다.
function invokeValue(target, thisValue, args, depth = 0, active = new Set()) {
  if (depth > MAX_EVIDENCE_DEPTH || active.has(target)) return invocation(target.possibleFetch ? possibleFetchValue : unknownValue, Boolean(target.possibleFetch));
  if (target.kind === "fetch" || target.possibleFetch) return invocation(otherValue, true);
  if (target.kind === "other" || target.kind === "unknown" || target.kind === "array") return invocation();
  active.add(target);
  try {
    if (target.kind === "bound") return invokeValue(target.target, target.thisValue, combineArgs(target.args, args), depth + 1, active);
    if (target.kind !== "intrinsic") return invocation();

    // call은 첫 인자를 새 this로 옮기고 receiver callable을 실행한다.
    if (target.method === "call") {
      if (!args.known) return thisValue.kind === "fetch" || thisValue.possibleFetch ? invocation(otherValue, true) : invocation(unknownValue, false);
      return invokeValue(thisValue, args.values[0] ?? otherValue, knownArgs(args.values.slice(1)), depth + 1, active);
    }

    // apply는 두 번째 인자의 표준 배열만 펼치며, 배열을 몰라도 fetch receiver 실행 자체는 숨기지 않는다.
    if (target.method === "apply") {
      if (!args.known) return thisValue.kind === "fetch" || thisValue.possibleFetch ? invocation(otherValue, true) : invocation(unknownValue, false);
      const applied = args.values[1];
      const appliedArgs = applied?.kind === "array" && applied.elements ? knownArgs(applied.elements) : unknownArgs;
      return invokeValue(thisValue, args.values[0] ?? otherValue, appliedArgs, depth + 1, active);
    }

    // bind는 receiver callable의 origin을 보존하되 아직 실행하지 않는다.
    const boundThis = args.known ? args.values[0] ?? otherValue : unknownValue;
    const boundArgs = args.known ? knownArgs(args.values.slice(1)) : unknownArgs;
    return invocation(boundValue(thisValue, boundThis, boundArgs));
  } finally {
    active.delete(target);
  }
}

// 한 CallExpression의 직접 효과와 반환 callable을 분리해 fetch(...).then(...) 같은 결과 chain을 중복하지 않는다.
function analyzeCall(checker, node, state, depth = 0) {
  const reference = callReference(checker, node.expression, state, depth + 1);
  const args = knownArgs(node.arguments.map((argument) => evaluateValue(checker, argument, state, depth + 1)));
  return invokeValue(reference.target, reference.thisValue, args);
}

// 공개 판정은 실제 CallExpression이 global fetch를 실행하는 경우에만 true다.
export function isGlobalFetchCall(checker, node) {
  if (!ts.isCallExpression(node)) return false;
  return analyzeCall(checker, node, {
    active: new Set(),
    allowEvidenceFallback: true,
    maxDepth: MAX_EXACT_DEPTH,
  }).invokesFetch;
}
