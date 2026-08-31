import ts from "typescript";

const sensitiveAssignmentNames = ["accesstoken", "apikey", "apitoken", "clientsecret", "password", "refreshtoken"];
const authorizationNames = new Set(["authorization", "proxyauthorization"]);

function unwrap(node) {
  let current = node;
  while (current && (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isTypeAssertionExpression(current) || ts.isSatisfiesExpression(current) || ts.isNonNullExpression(current))) current = current.expression;
  return current;
}

function stringValue(node) {
  const current = unwrap(node);
  return current && ts.isStringLiteralLike(current) ? current.text : undefined;
}

function fieldName(node) {
  const current = unwrap(node);
  if (!current) return undefined;
  if (ts.isIdentifier(current) || ts.isPrivateIdentifier(current) || ts.isStringLiteralLike(current)) return current.text;
  if (ts.isPropertyAccessExpression(current)) return current.name.text;
  if (ts.isElementAccessExpression(current)) return stringValue(current.argumentExpression);
  return undefined;
}

function normalizedFieldName(node) {
  return fieldName(node)?.replaceAll(/[^a-z0-9]/gi, "").toLowerCase();
}

function isSensitiveAssignmentName(node) {
  const normalized = normalizedFieldName(node);
  return Boolean(normalized && sensitiveAssignmentNames.some((name) => normalized === name || normalized.endsWith(name)));
}

function isAuthorizationName(node) {
  const normalized = normalizedFieldName(node);
  return Boolean(normalized && authorizationNames.has(normalized));
}

function isBasicCredential(value) {
  const match = /^basic\s+([A-Za-z0-9+/]{8,}={0,2})$/i.exec(value);
  if (!match) return false;
  const decoded = Buffer.from(match[1], "base64");
  const canonical = decoded.toString("base64").replace(/=+$/, "");
  return canonical === match[1].replace(/=+$/, "") && /^[\x20-\x7e]*:[\x20-\x7e]*$/.test(decoded.toString("utf8"));
}

function containsCredentialValue(value) {
  const trimmed = value.trim();
  return /-----BEGIN (?:EC |OPENSSH |RSA )?PRIVATE KEY-----/i.test(trimmed)
    || /\b(?:AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,})\b/.test(trimmed)
    || /^bearer\s+[A-Za-z0-9._~+/-]{16,}={0,2}$/i.test(trimmed)
    || isBasicCredential(trimmed)
    || /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/.test(trimmed)
    || /\bhttps?:\/\/[^\s/@:'"`]+:[^\s/@'"`]+@[^\s/'"`]+/i.test(trimmed);
}

function assignedLiteralIsSensitive(name, initializer) {
  const value = stringValue(initializer);
  if (value === undefined) return false;
  if (isAuthorizationName(name)) return containsCredentialValue(value);
  return isSensitiveAssignmentName(name) && value.trim().length >= 4;
}

function callSetsAuthorization(node) {
  if (!ts.isCallExpression(node) || node.arguments.length < 2) return false;
  const callee = unwrap(node.expression);
  if (!(ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee))) return false;
  const method = normalizedFieldName(ts.isPropertyAccessExpression(callee) ? callee.name : callee.argumentExpression);
  return ["append", "set"].includes(method) && isAuthorizationName(node.arguments[0]) && containsCredentialValue(stringValue(node.arguments[1]) ?? "");
}

function scriptKind(fileName) {
  if (/\.tsx$/i.test(fileName)) return ts.ScriptKind.TSX;
  if (/\.jsx$/i.test(fileName)) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/i.test(fileName)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

export function hasSensitiveContent(contents, fileName = "review-source.ts") {
  if (/-----BEGIN (?:EC |OPENSSH |RSA )?PRIVATE KEY-----/i.test(contents)) return true;
  const sourceFile = ts.createSourceFile(fileName, contents, ts.ScriptTarget.ESNext, true, scriptKind(fileName));
  let found = false;
  const visit = (node) => {
    if (found) return;
    if (ts.isStringLiteralLike(node) && containsCredentialValue(node.text)) found = true;
    else if (ts.isVariableDeclaration(node) && assignedLiteralIsSensitive(node.name, node.initializer)) found = true;
    else if (ts.isPropertyAssignment(node) && assignedLiteralIsSensitive(node.name, node.initializer)) found = true;
    else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && assignedLiteralIsSensitive(node.left, node.right)) found = true;
    else if (ts.isJsxAttribute(node) && assignedLiteralIsSensitive(node.name, node.initializer)) found = true;
    else if (callSetsAuthorization(node)) found = true;
    if (!found) ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}
