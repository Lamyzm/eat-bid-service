import ts from "typescript";

const unknown = "\u0000";

function result(value, known, kind = typeof value) {
  return { text: known ? String(value) : value, value, known, kind };
}

export function unwrapExpression(node) {
  let current = node;
  while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isTypeAssertionExpression(current) || ts.isSatisfiesExpression(current) || ts.isNonNullExpression(current)) current = current.expression;
  return current;
}

function join(left, right) {
  return result(`${left.text}${right.text}`, left.known && right.known, left.kind === "string" || right.kind === "string" ? "string" : "number");
}

function constInitializer(checker, node) {
  const symbol = checker.getSymbolAtLocation(node);
  const target = symbol?.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  const declaration = target?.declarations?.find(ts.isVariableDeclaration);
  return declaration && ts.isVariableDeclarationList(declaration.parent) && (declaration.parent.flags & ts.NodeFlags.Const) && declaration.initializer ? declaration.initializer : undefined;
}

export function staticExpression(checker, node, seen = new Set()) {
  const current = unwrapExpression(node);
  if (seen.has(current)) return result(unknown, false);
  seen.add(current);
  if (ts.isStringLiteralLike(current)) return result(current.text, true, "string");
  if (ts.isNumericLiteral(current)) return result(Number(current.text), true, "number");
  if (current.kind === ts.SyntaxKind.TrueKeyword) return result(true, true, "boolean");
  if (current.kind === ts.SyntaxKind.FalseKeyword) return result(false, true, "boolean");
  if (current.kind === ts.SyntaxKind.NullKeyword) return result(null, true, "null");
  if (ts.isIdentifier(current)) {
    const initializer = constInitializer(checker, current);
    return initializer ? staticExpression(checker, initializer, seen) : result(unknown, false);
  }
  if (ts.isTemplateExpression(current)) {
    let accumulated = result(current.head.text, true, "string");
    for (const span of current.templateSpans) accumulated = join(join(accumulated, staticExpression(checker, span.expression, seen)), result(span.literal.text, true, "string"));
    return accumulated;
  }
  if (ts.isPrefixUnaryExpression(current)) {
    const operand = staticExpression(checker, current.operand, seen);
    if (!operand.known || operand.kind !== "number") return result(`${current.operator === ts.SyntaxKind.MinusToken ? "-" : ""}${operand.text}`, false);
    if (current.operator === ts.SyntaxKind.PlusToken) return operand;
    if (current.operator === ts.SyntaxKind.MinusToken) return result(-operand.value, true, "number");
    return result(unknown, false);
  }
  if (!ts.isBinaryExpression(current)) return result(unknown, false);
  const left = staticExpression(checker, current.left, seen);
  const right = staticExpression(checker, current.right, seen);
  if (current.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    if (left.kind === "string" || right.kind === "string") return join(left, right);
    if (left.known && right.known && left.kind === "number" && right.kind === "number") return result(left.value + right.value, true, "number");
    return result(`${left.text}${right.text}`, false);
  }
  if (!left.known || !right.known || left.kind !== "number" || right.kind !== "number") return result(unknown, false);
  const operator = current.operatorToken.kind;
  if (operator === ts.SyntaxKind.MinusToken) return result(left.value - right.value, true, "number");
  if (operator === ts.SyntaxKind.AsteriskToken) return result(left.value * right.value, true, "number");
  if (operator === ts.SyntaxKind.SlashToken) return result(left.value / right.value, true, "number");
  if (operator === ts.SyntaxKind.PercentToken) return result(left.value % right.value, true, "number");
  if (operator === ts.SyntaxKind.AsteriskAsteriskToken) return result(left.value ** right.value, true, "number");
  return result(unknown, false);
}

export function staticPropertyName(checker, node) {
  const current = unwrapExpression(node);
  if (ts.isPropertyAccessExpression(current)) return current.name.text;
  if (!ts.isElementAccessExpression(current) || !current.argumentExpression) return undefined;
  const evaluated = staticExpression(checker, current.argumentExpression);
  return evaluated.known && typeof evaluated.value === "string" ? evaluated.value : undefined;
}
