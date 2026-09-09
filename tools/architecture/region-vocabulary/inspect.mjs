/** @module 책임: TypeScript source를 훑어 지역 어휘 재선언 다섯 규칙의 finding을 예외 없이 만든다. */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import {
  MIN_COORDINATE_TABLE_ENTRIES,
  REGION_VOCABULARY_RULES,
  codePointCompare,
  coordinateKeysOf,
  isObservedNameMember,
  isRegionIdentifierName,
  isSchemeDeclarationPath,
  isTestOrFixture,
  isTypeScriptSource,
  normalizedPath,
  readDeclaredSchemeNames,
  schemeAtomFailures,
} from "./policy.mjs";

const IGNORED_DIRECTORIES = new Set(["node_modules", ".next", "dist", "coverage", "drizzle", "generated"]);

function sourceFiles(root) {
  const files = [];
  const visit = (entry) => {
    if (!existsSync(entry)) return;
    if (statSync(entry).isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(path.basename(entry))) for (const child of readdirSync(entry)) visit(path.join(entry, child));
    } else if (isTypeScriptSource(entry) && !isTestOrFixture(entry)) {
      files.push(entry);
    }
  };
  visit(root);
  return files.sort(codePointCompare);
}

function nameOf(node) {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.name)) return node.name.text;
  return undefined;
}

/** 이름 조립의 재료다. template literal이 지역 이름 값을 둘 이상 이어 붙이면 그 결과가 키가 된다. */
function regionExpressionCount(template) {
  if (!ts.isTemplateExpression(template)) return 0;
  let count = 0;
  for (const span of template.templateSpans) {
    if (isRegionIdentifierName(nameOf(span.expression))) count += 1;
  }
  return count;
}

function isKeyPosition(node) {
  const parent = node.parent;
  if (!parent) return false;
  if (ts.isElementAccessExpression(parent) && parent.argumentExpression === node) return true;
  if (ts.isComputedPropertyName(parent)) return true;
  return false;
}

function stringLiteralOf(node) {
  return ts.isStringLiteralLike(node) ? node.text : undefined;
}

/** 관측된 이름을 가리키는 표현이다. `r.name`·`r.label`과 지역 이름 문자열 리터럴 둘 다 이 부류다. */
function comparedNameOperand(node, schemes) {
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.name) && isObservedNameMember(node.name.text)) return true;
  const literal = stringLiteralOf(node);
  // 체계 이름과의 비교는 이름 비교가 아니라 체계 판정이므로 규칙 밖이다(R2가 따로 본다).
  return literal !== undefined && literal.trim() !== "" && !schemes.has(literal);
}

function isRegionOperand(node) {
  return isRegionIdentifierName(nameOf(node));
}

function coordinateEntryCount(node) {
  if (ts.isArrayLiteralExpression(node)) {
    let count = 0;
    for (const element of node.elements) {
      if (ts.isArrayLiteralExpression(element) && element.elements.length === 2
        && element.elements.every((value) => ts.isNumericLiteral(value)
          || (ts.isPrefixUnaryExpression(value) && ts.isNumericLiteral(value.operand)))) {
        count += 1;
        continue;
      }
      if (ts.isObjectLiteralExpression(element) && isCoordinateObject(element)) count += 1;
    }
    return count;
  }
  if (!ts.isObjectLiteralExpression(node)) return 0;
  let count = 0;
  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const value = property.initializer;
    if (ts.isArrayLiteralExpression(value) && value.elements.length === 2
      && value.elements.every((element) => ts.isNumericLiteral(element)
        || (ts.isPrefixUnaryExpression(element) && ts.isNumericLiteral(element.operand)))) {
      count += 1;
      continue;
    }
    if (ts.isObjectLiteralExpression(value) && isCoordinateObject(value)) count += 1;
  }
  return count;
}

function isCoordinateObject(node) {
  const keys = new Set();
  for (const property of node.properties) {
    if (ts.isPropertyAssignment(property) && (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name))) {
      keys.add(property.name.text);
    }
  }
  return coordinateKeysOf(keys);
}

function schemesInText(text, schemes) {
  const found = new Set();
  for (const scheme of schemes) if (text.includes(scheme)) found.add(scheme);
  return found;
}

function add(findings, relativePath, rule, node, sourceFile, reason) {
  const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  findings.push({
    rule,
    path: relativePath,
    kind: ts.SyntaxKind[node.kind],
    line: line + 1,
    reason,
  });
}

function scanFile(findings, sourceFile, relativePath, schemes) {
  const declarationSite = isSchemeDeclarationPath(relativePath);
  const visit = (node) => {
    // R1 — 지역 이름 값 둘 이상을 이어 붙인 문자열이 index·객체 키로 쓰이는 곳
    if (ts.isTemplateExpression(node) && regionExpressionCount(node) >= 2 && isKeyPosition(node)) {
      add(findings, relativePath, REGION_VOCABULARY_RULES.NAME_COMPOSED_KEY, node, sourceFile,
        "지역 이름을 이어 붙인 문자열을 키로 씁니다. 정체성은 숫자 code_value_id입니다.");
    }

    // R2 — 체계 이름은 선언 권위에서만 문자열로 나타난다
    if (!declarationSite && ts.isStringLiteralLike(node) && schemes.has(node.text)) {
      add(findings, relativePath, REGION_VOCABULARY_RULES.SCHEME_LITERAL_REDECLARED, node, sourceFile,
        "코드 체계 이름을 다시 선언합니다. 선언 권위에서 참조하십시오.");
    }

    // R3 — 지역 이름을 문자열이나 관측 라벨과 비교하는 곳
    if (ts.isBinaryExpression(node)
      && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(node.operatorToken.kind)
      && ((isRegionOperand(node.left) && comparedNameOperand(node.right, schemes))
        || (isRegionOperand(node.right) && comparedNameOperand(node.left, schemes)))) {
      add(findings, relativePath, REGION_VOCABULARY_RULES.REGION_NAME_COMPARISON, node, sourceFile,
        "지역을 이름으로 비교합니다. 코드 값 식별자로 비교하십시오.");
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && ts.isIdentifier(node.expression.name) && ["includes", "indexOf"].includes(node.expression.name.text)
      && node.arguments.length === 1
      && ((isRegionOperand(node.expression.expression) && comparedNameOperand(node.arguments[0], schemes))
        || (isRegionOperand(node.arguments[0]) && comparedNameOperand(node.expression.expression, schemes)))) {
      add(findings, relativePath, REGION_VOCABULARY_RULES.REGION_NAME_COMPARISON, node, sourceFile,
        "지역을 이름으로 조회합니다. 코드 값 식별자로 조회하십시오.");
    }
    if (ts.isSwitchStatement(node) && isRegionOperand(node.expression)
      && node.caseBlock.clauses.some((clause) => ts.isCaseClause(clause) && comparedNameOperand(clause.expression, schemes))) {
      add(findings, relativePath, REGION_VOCABULARY_RULES.REGION_NAME_COMPARISON, node.expression, sourceFile,
        "지역 이름으로 분기합니다. 코드 값 식별자로 분기하십시오.");
    }

    // R4 — 좌표표 재선언
    if ((ts.isObjectLiteralExpression(node) || ts.isArrayLiteralExpression(node))
      && coordinateEntryCount(node) >= MIN_COORDINATE_TABLE_ENTRIES) {
      add(findings, relativePath, REGION_VOCABULARY_RULES.COORDINATE_TABLE_REDECLARED, node, sourceFile,
        "좌표표를 소스에 다시 선언합니다. 좌표의 권위는 core.code_value_coordinate입니다.");
    }

    // R5 — 한 질의 문자열이 두 체계를 매핑 없이 잇는 곳
    if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
      const raw = node.getText(sourceFile);
      if (schemesInText(raw, schemes).size >= 2 && !raw.includes("code_mapping")) {
        add(findings, relativePath, REGION_VOCABULARY_RULES.CROSS_SCHEME_JOIN, node, sourceFile,
          "한 질의가 두 코드 체계를 code_mapping 없이 잇습니다.");
      }
    }

    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
}

/** 모든 finding이 곧 실패다. 예외 목록을 두지 않는 이유는 좌표표가 그 자리로 되돌아오기 때문이다(ADR 0035). */
export function inspectRegionVocabulary({ repoRoot, sourceRoots }) {
  const { schemes, failures } = readDeclaredSchemeNames(repoRoot);
  const findings = [];
  for (const root of sourceRoots) {
    for (const file of sourceFiles(path.join(repoRoot, root))) {
      const source = readFileSync(file, "utf8");
      const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      scanFile(findings, sourceFile, normalizedPath(repoRoot, file), schemes);
    }
  }
  findings.sort((left, right) => codePointCompare(`${left.path}\0${left.rule}\0${String(left.line).padStart(8, "0")}`, `${right.path}\0${right.rule}\0${String(right.line).padStart(8, "0")}`));
  return {
    schemes: [...schemes].sort(codePointCompare),
    findings,
    failures: [...failures, ...schemeAtomFailures(repoRoot, schemes)],
  };
}
