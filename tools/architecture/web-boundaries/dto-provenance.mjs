/** @module 책임: Web API의 수동 공개 DTO 선언과 type alias provenance 우회를 추적한다. */
import path from "node:path";
import ts from "typescript";
import { normalizedPath } from "./policy.mjs";
import { unwrapExpression } from "./static-analysis.mjs";

const safeBuiltinTypes = new Set(["Date"]);

function display(root, file) {
  return normalizedPath(root, file).replaceAll("\\", "/");
}

function resolvedSymbol(checker, node) {
  let symbol = checker.getSymbolAtLocation(node);
  if (symbol?.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
  return symbol;
}

function isContractDeclaration(root, declaration) {
  const declarationPath = display(root, declaration.getSourceFile().fileName);
  return declarationPath.startsWith("packages/contracts/src/api/") || /(?:^|\/)node_modules\/@eatbid\/contracts(?:\/|$)/.test(declarationPath);
}

function isBuiltinDeclaration(declaration) {
  return declaration.getSourceFile().isDeclarationFile && /^lib\..*\.d\.ts$/i.test(path.basename(declaration.getSourceFile().fileName));
}

function declarationName(declaration) {
  return declaration.name && ts.isIdentifier(declaration.name) ? declaration.name.text : undefined;
}

function typeIsSafeBuiltin(checker, node) {
  const symbol = checker.getTypeAtLocation(node).getSymbol?.();
  return symbol?.getName() === "Date";
}

function manualValue(root, checker, declaration, seenDeclarations, seenNodes) {
  if (ts.isVariableDeclaration(declaration)) {
    if (declaration.initializer && (ts.isObjectLiteralExpression(unwrapExpression(declaration.initializer)) || ts.isArrayLiteralExpression(unwrapExpression(declaration.initializer)))) return true;
    return !typeIsSafeBuiltin(checker, declaration.name) && Boolean(checker.getTypeAtLocation(declaration.name).flags & ts.TypeFlags.Object);
  }
  if (ts.isFunctionDeclaration(declaration) || ts.isMethodDeclaration(declaration) || ts.isFunctionExpression(declaration) || ts.isArrowFunction(declaration)) return declaration.type ? manualTypeNode(root, checker, declaration.type, seenDeclarations, seenNodes) : true;
  return true;
}

function manualTypeNode(root, checker, node, seenDeclarations = new Set(), seenNodes = new Set()) {
  if (!node || seenNodes.has(node)) return false;
  seenNodes.add(node);
  if (ts.isTypeLiteralNode(node) || ts.isMappedTypeNode(node) || ts.isTupleTypeNode(node) || ts.isArrayTypeNode(node)) return true;
  if (ts.isFunctionTypeNode(node) || ts.isConstructorTypeNode(node)) return node.type ? manualTypeNode(root, checker, node.type, seenDeclarations, seenNodes) : true;
  if (ts.isTypeQueryNode(node)) return (resolvedSymbol(checker, node.exprName)?.declarations ?? []).some((declaration) => manualValue(root, checker, declaration, seenDeclarations, seenNodes));
  if (ts.isParenthesizedTypeNode(node) || ts.isTypeOperatorNode(node) || ts.isRestTypeNode(node) || ts.isOptionalTypeNode(node)) return manualTypeNode(root, checker, node.type, seenDeclarations, seenNodes);
  if (ts.isUnionTypeNode(node) || ts.isIntersectionTypeNode(node)) return node.types.some((type) => manualTypeNode(root, checker, type, seenDeclarations, seenNodes));
  if (ts.isIndexedAccessTypeNode(node)) return manualTypeNode(root, checker, node.objectType, seenDeclarations, seenNodes) || manualTypeNode(root, checker, node.indexType, seenDeclarations, seenNodes);
  if (ts.isConditionalTypeNode(node)) return [node.checkType, node.extendsType, node.trueType, node.falseType].some((type) => manualTypeNode(root, checker, type, seenDeclarations, seenNodes));
  if (ts.isInferTypeNode(node)) return manualDeclaration(root, checker, node.typeParameter, seenDeclarations, seenNodes);
  if (ts.isImportTypeNode(node)) {
    if (node.typeArguments?.some((argument) => manualTypeNode(root, checker, argument, seenDeclarations, seenNodes))) return true;
    return (resolvedSymbol(checker, node.qualifier ?? node)?.declarations ?? []).some((declaration) => manualDeclaration(root, checker, declaration, seenDeclarations, seenNodes));
  }
  if (!ts.isTypeReferenceNode(node)) return false;
  if (node.typeArguments?.some((argument) => manualTypeNode(root, checker, argument, seenDeclarations, seenNodes))) return true;
  return (resolvedSymbol(checker, node.typeName)?.declarations ?? []).some((declaration) => manualDeclaration(root, checker, declaration, seenDeclarations, seenNodes));
}

function manualDeclaration(root, checker, declaration, seenDeclarations = new Set(), seenNodes = new Set()) {
  if (seenDeclarations.has(declaration) || isContractDeclaration(root, declaration)) return false;
  seenDeclarations.add(declaration);
  if (isBuiltinDeclaration(declaration)) return !safeBuiltinTypes.has(declarationName(declaration));
  if (ts.isTypeParameterDeclaration(declaration) || ts.isClassDeclaration(declaration) || ts.isInterfaceDeclaration(declaration)) return true;
  if (ts.isTypeAliasDeclaration(declaration)) return manualTypeNode(root, checker, declaration.type, seenDeclarations, seenNodes);
  return manualValue(root, checker, declaration, seenDeclarations, seenNodes);
}

export function exportedManualDtos(root, checker, sourceFile) {
  const module = checker.getSymbolAtLocation(sourceFile);
  if (!module) return [];
  const declarations = [];
  for (const exported of checker.getExportsOfModule(module)) {
    if (!/(?:Response|Dto)$/i.test(exported.getName())) continue;
    const target = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
    for (const declaration of target.declarations ?? []) if (manualDeclaration(root, checker, declaration)) declarations.push(declaration);
  }
  return [...new Set(declarations)];
}
