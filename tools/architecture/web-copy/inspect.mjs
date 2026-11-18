/** @module 책임: web 화면 소스의 문자열·template·JSX 글을 훑어 금지 말과 질문형 문구 finding을 파일 단위 열쇠와 함께 만든다. */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { isTestOrFixture, isTypeScriptSource, normalizedPath } from "../decision-vocabulary/policy.mjs";
import { COPY_RULES, forbiddenWord, isQuestion } from "./policy.mjs";

const IGNORED_DIRECTORIES = new Set(["node_modules", ".next", "dist", "coverage", "generated"]);

function sourceFiles(root) {
  const files = [];
  const visit = (entry) => {
    if (!existsSync(entry)) return;
    if (statSync(entry).isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(path.basename(entry))) for (const child of readdirSync(entry)) visit(path.join(entry, child));
    } else if (isTypeScriptSource(entry) && !isTestOrFixture(entry)) files.push(entry);
  };
  visit(root);
  return files.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

/** 사용자가 읽을 수 있는 글자만 모은다. 주석·식별자·import 경로는 화면에 나오지 않는다. */
function visibleTexts(sourceFile) {
  const texts = [];
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))) return;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node) || ts.isJsxText(node)) {
      if (node.text.trim()) texts.push({ text: node.text, position: node.getStart(sourceFile) });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return texts;
}

/** 파일마다 규칙별 첫 위반 한 줄만 보고한다. 열쇠는 파일 경로라 같은 파일의 위반이 늘어도 목록은 그대로다. */
export function inspectWebCopy({ repoRoot, sourceRoot }) {
  const findings = [];
  let fileCount = 0;
  for (const filePath of sourceFiles(path.join(repoRoot, sourceRoot))) {
    fileCount += 1;
    const source = readFileSync(filePath, "utf8");
    const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, filePath.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const displayPath = normalizedPath(repoRoot, filePath);
    const seen = new Set();
    for (const { text, position } of visibleTexts(sourceFile)) {
      const line = sourceFile.getLineAndCharacterOfPosition(position).line + 1;
      const word = forbiddenWord(text);
      if (word !== undefined && !seen.has(COPY_RULES.FORBIDDEN_WORD)) {
        seen.add(COPY_RULES.FORBIDDEN_WORD);
        findings.push({ rule: COPY_RULES.FORBIDDEN_WORD, path: displayPath, key: displayPath, line, phrase: word, reason: "우리 연구·코드 말은 사용자 화면에 쓰지 않습니다. 대신 쓸 말은 docs/product/ui-words.md \"쓰지 않는 말\" 표에 있습니다." });
      }
      if (isQuestion(text) && !seen.has(COPY_RULES.QUESTION)) {
        seen.add(COPY_RULES.QUESTION);
        findings.push({ rule: COPY_RULES.QUESTION, path: displayPath, key: displayPath, line, phrase: text.trim().slice(0, 40), reason: "화면 글은 묻지 않고 할 일과 사실을 말합니다(질문형 문구 금지)." });
      }
    }
  }
  return { findings, fileCount };
}
