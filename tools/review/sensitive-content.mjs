import ts from "typescript";

// 이 모듈은 review evidence에 들어갈 source만 보수적으로 선별한다.
// credential 값은 반환하거나 진단에 싣지 않고, 호출자는 민감 여부 boolean만 받는다.
const MAX_STATIC_STEPS = 512;
const sensitiveAssignmentNames = ["accesstoken", "apikey", "apitoken", "clientsecret", "password", "refreshtoken"];
const authorizationNames = new Set(["authorization", "proxyauthorization"]);
const safeCredentialExamples = new Set(["", "***", "<redacted>", "[redacted]", "example", "placeholder", "redacted"]);
const indeterminateString = Object.freeze({ known: false });

function knownString(value) {
  return { known: true, value };
}

// syntax wrapper는 값 의미를 바꾸지 않는다. JSX와 computed property도 같은 evaluator 경계로 접는다.
function unwrap(node) {
  let current = node;
  while (current) {
    if (ts.isJsxExpression(current) || ts.isComputedPropertyName(current)) current = current.expression;
    else if (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isTypeAssertionExpression(current) || ts.isSatisfiesExpression(current) || ts.isNonNullExpression(current)) current = current.expression;
    else break;
  }
  return current;
}

// 이름 문자열이 아니라 실제 identifier use의 lexical symbol을 따라가야 sibling/nested shadow가 섞이지 않는다.
// import나 다른 파일은 evidence 범위를 넓히지 않고, 같은 source의 단일 const 선언만 정적으로 해석한다.
function constDeclaration(identifier, context) {
  const symbol = context.checker.getSymbolAtLocation(identifier);
  const declarations = symbol?.declarations?.filter((declaration) => declaration.getSourceFile() === context.sourceFile
    && ts.isVariableDeclaration(declaration)
    && ts.isIdentifier(declaration.name)
    && declaration.initializer
    && ts.isVariableDeclarationList(declaration.parent)
    && Boolean(declaration.parent.flags & ts.NodeFlags.Const));
  return declarations?.length === 1 ? declarations[0] : undefined;
}

function evaluationState() {
  return { active: new Set(), activeDeclarations: new Set(), steps: 0 };
}

// 문자열 조합은 literal/template/plus/단일 const만 허용한다.
// 순환 stack과 명시적 step 한도 중 하나라도 걸리면 값을 만들지 않고 indeterminate를 반환한다.
function staticString(node, context, state = evaluationState()) {
  if (!node || state.steps >= MAX_STATIC_STEPS) return indeterminateString;
  state.steps += 1;
  const current = unwrap(node);
  if (!current || state.active.has(current)) return indeterminateString;
  state.active.add(current);
  try {
    if (ts.isStringLiteralLike(current)) return knownString(current.text);
    if (ts.isIdentifier(current)) {
      const declaration = constDeclaration(current, context);
      if (!declaration || state.activeDeclarations.has(declaration)) return indeterminateString;
      state.activeDeclarations.add(declaration);
      try {
        return staticString(declaration.initializer, context, state);
      } finally {
        state.activeDeclarations.delete(declaration);
      }
    }
    if (ts.isTemplateExpression(current)) {
      let value = current.head.text;
      for (const span of current.templateSpans) {
        const expression = staticString(span.expression, context, state);
        if (!expression.known) return indeterminateString;
        value += `${expression.value}${span.literal.text}`;
      }
      return knownString(value);
    }
    if (ts.isBinaryExpression(current) && current.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = staticString(current.left, context, state);
      if (!left.known) return indeterminateString;
      const right = staticString(current.right, context, state);
      return right.known ? knownString(`${left.value}${right.value}`) : indeterminateString;
    }
    return indeterminateString;
  } finally {
    state.active.delete(current);
  }
}

// 선언/속성 이름은 식별자 자체를 이름으로 읽고, bracket/computed/header 인자만 정적 문자열로 계산한다.
function fieldName(node, context, resolveIdentifier = false) {
  const current = unwrap(node);
  if (!current) return undefined;
  if (ts.isIdentifier(current) || ts.isPrivateIdentifier(current)) {
    if (!resolveIdentifier) return current.text;
    const evaluated = staticString(current, context);
    return evaluated.known ? evaluated.value : undefined;
  }
  if (ts.isStringLiteralLike(current)) return current.text;
  if (ts.isPropertyAccessExpression(current)) return current.name.text;
  if (ts.isElementAccessExpression(current)) {
    const evaluated = staticString(current.argumentExpression, context);
    return evaluated.known ? evaluated.value : undefined;
  }
  const evaluated = staticString(current, context);
  return evaluated.known ? evaluated.value : undefined;
}

function normalizedFieldName(node, context, resolveIdentifier = false) {
  return fieldName(node, context, resolveIdentifier)?.replaceAll(/[^a-z0-9]/gi, "").toLowerCase();
}

// suffix 허용은 serviceApiKey 같은 실제 소유 필드를 포함하되 일반 tokenCount는 포함하지 않는 기존 경계다.
function isSensitiveAssignmentName(node, context, resolveIdentifier = false) {
  const normalized = normalizedFieldName(node, context, resolveIdentifier);
  return Boolean(normalized && sensitiveAssignmentNames.some((name) => normalized === name || normalized.endsWith(name)));
}

function isAuthorizationName(node, context, resolveIdentifier = false) {
  const normalized = normalizedFieldName(node, context, resolveIdentifier);
  return Boolean(normalized && authorizationNames.has(normalized));
}

// context-free Basic 탐지는 canonical base64와 printable user:password 모양을 함께 요구해 문서 문구를 보존한다.
function isBasicCredential(value) {
  const match = /^basic\s+([A-Za-z0-9+/]{8,}={0,2})$/i.exec(value);
  if (!match) return false;
  const decoded = Buffer.from(match[1], "base64");
  const canonical = decoded.toString("base64").replace(/=+$/, "");
  return canonical === match[1].replace(/=+$/, "") && /^[\x20-\x7e]*:[\x20-\x7e]*$/.test(decoded.toString("utf8"));
}

// 소유권 문맥이 없는 문자열은 강한 credential 모양만 차단해 일반 인증 설명과 기능명을 허용한다.
function containsCredentialValue(value) {
  const trimmed = value.trim();
  return /-----BEGIN (?:EC |OPENSSH |RSA )?PRIVATE KEY-----/i.test(trimmed)
    || /\b(?:AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,})\b/.test(trimmed)
    || /^bearer\s+[A-Za-z0-9._~+/-]{16,}={0,2}$/i.test(trimmed)
    || isBasicCredential(trimmed)
    || /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/.test(trimmed)
    || /\bhttps?:\/\/[^\s/@:'"`]+:[^\s/@'"`]+@[^\s/'"`]+/i.test(trimmed);
}

// credential owner가 확인된 값은 explicit safe literal만 통과한다.
// dynamic, cycle, depth exhaustion은 모두 indeterminate이므로 값 노출 없이 차단한다.
function credentialValueIsSensitive(node, context) {
  const evaluated = staticString(node, context);
  return !evaluated.known || !safeCredentialExamples.has(evaluated.value.trim().toLowerCase());
}

function assignedValueIsSensitive(name, initializer, context) {
  // computed property의 identifier는 실제 header 문자열을 뜻하지만 일반 property identifier는 이름 자체다.
  const resolveIdentifier = ts.isComputedPropertyName(name);
  const owned = isAuthorizationName(name, context, resolveIdentifier) || isSensitiveAssignmentName(name, context, resolveIdentifier);
  return owned && credentialValueIsSensitive(initializer, context);
}

// Headers.set/append는 계산된 method/header 이름을 허용하되 Authorization 소유 값은 같은 fail-closed 정책을 쓴다.
function callSetsAuthorization(node, context) {
  if (!ts.isCallExpression(node) || node.arguments.length < 2) return false;
  const callee = unwrap(node.expression);
  if (!(ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee))) return false;
  const methodNode = ts.isPropertyAccessExpression(callee) ? callee.name : callee.argumentExpression;
  const method = normalizedFieldName(methodNode, context);
  return ["append", "set"].includes(method)
    && isAuthorizationName(node.arguments[0], context, true)
    && credentialValueIsSensitive(node.arguments[1], context);
}

function isHeadersConstructor(node) {
  const current = unwrap(node);
  if (ts.isIdentifier(current)) return current.text === "Headers";
  return ts.isPropertyAccessExpression(current)
    && current.name.text === "Headers"
    && ts.isIdentifier(unwrap(current.expression))
    && ["globalThis", "window"].includes(unwrap(current.expression).text);
}

// 표준 Headers init의 object와 tuple 두 형태를 모두 검사한다.
// 알 수 없는 spread 전체를 secret로 단정하지 않고, credential header 이름이 증명된 entry만 차단한다.
function headersInitializerIsSensitive(node, context) {
  if (!ts.isNewExpression(node) || !isHeadersConstructor(node.expression) || !node.arguments?.length) return false;
  const initializer = unwrap(node.arguments[0]);
  if (ts.isObjectLiteralExpression(initializer)) {
    return initializer.properties.some((property) => {
      if (ts.isPropertyAssignment(property)) return assignedValueIsSensitive(property.name, property.initializer, context);
      if (ts.isShorthandPropertyAssignment(property) && isAuthorizationName(property.name, context)) return credentialValueIsSensitive(property.name, context);
      return false;
    });
  }
  if (!ts.isArrayLiteralExpression(initializer)) return false;
  return initializer.elements.some((entry) => {
    const tuple = unwrap(entry);
    return ts.isArrayLiteralExpression(tuple)
      && tuple.elements.length >= 2
      && isAuthorizationName(tuple.elements[0], context, true)
      && credentialValueIsSensitive(tuple.elements[1], context);
  });
}

// parser mode는 evidence 파일 확장자만 반영하며 JSX 여부 외의 정책을 바꾸지 않는다.
function scriptKind(fileName) {
  if (/\.tsx$/i.test(fileName)) return ts.ScriptKind.TSX;
  if (/\.jsx$/i.test(fileName)) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/i.test(fileName)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

// no-lib 단일 source program은 외부 파일을 읽지 않으면서도 TypeScript binder의 lexical symbol 소유권을 제공한다.
function sourceAnalysis(contents, fileName) {
  const options = { allowJs: true, checkJs: false, jsx: ts.JsxEmit.Preserve, noLib: true, noResolve: true, target: ts.ScriptTarget.ESNext };
  const resolvedFileName = ts.sys.resolvePath(fileName);
  const sourceFile = ts.createSourceFile(resolvedFileName, contents, ts.ScriptTarget.ESNext, true, scriptKind(fileName));
  const host = ts.createCompilerHost(options, true);
  const canonicalFileName = host.getCanonicalFileName(resolvedFileName);
  const isSubject = (candidate) => host.getCanonicalFileName(ts.sys.resolvePath(candidate)) === canonicalFileName;
  host.fileExists = isSubject;
  host.readFile = (candidate) => isSubject(candidate) ? contents : undefined;
  host.getSourceFile = (candidate) => isSubject(candidate) ? sourceFile : undefined;
  const program = ts.createProgram({ rootNames: [resolvedFileName], options, host });
  return { checker: program.getTypeChecker(), sourceFile: program.getSourceFile(resolvedFileName) ?? sourceFile };
}

// 공개 API는 source 자체를 반환하지 않고 민감 여부만 알려 catalog exclusion reason을 고정한다.
export function hasSensitiveContent(contents, fileName = "review-source.ts") {
  if (/-----BEGIN (?:EC |OPENSSH |RSA )?PRIVATE KEY-----/i.test(contents)) return true;
  const context = sourceAnalysis(contents, fileName);
  const { sourceFile } = context;
  let found = false;
  const visit = (node) => {
    if (found) return;
    if (ts.isStringLiteralLike(node) && containsCredentialValue(node.text)) found = true;
    else if (ts.isVariableDeclaration(node) && assignedValueIsSensitive(node.name, node.initializer, context)) found = true;
    else if (ts.isPropertyAssignment(node) && assignedValueIsSensitive(node.name, node.initializer, context)) found = true;
    else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && assignedValueIsSensitive(node.left, node.right, context)) found = true;
    else if (ts.isJsxAttribute(node) && assignedValueIsSensitive(node.name, node.initializer, context)) found = true;
    else if (callSetsAuthorization(node, context) || headersInitializerIsSensitive(node, context)) found = true;
    if (!found) ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}
