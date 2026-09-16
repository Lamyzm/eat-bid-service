/** @module 책임: web TypeScript source의 문자열·template·JSX 텍스트를 훑어 결정 어휘 금지 규칙의 finding을 예외 없이 만든다. */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { DECISION_VOCABULARY_RULES, isTestOrFixture, isTypeScriptSource, normalizedPath } from "./policy.mjs";

const IGNORED_DIRECTORIES = new Set(["node_modules", ".next", "dist", "coverage", "generated"]);

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
  return files.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

/** 사용자가 읽을 수 있는 글자만 모은다. 주석·식별자·import 경로는 화면에 나오지 않는다. */
function visibleTexts(sourceFile) {
  const texts = [];
  const push = (node, text) => {
    if (text.trim()) texts.push({ text, position: node.getStart(sourceFile) });
  };
  const visit = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) push(node, node.text);
    else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) push(node, node.text);
    else if (ts.isJsxText(node)) push(node, node.text);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return texts;
}

export function inspectDecisionVocabulary({ repoRoot, sourceRoots }) {
  const findings = [];
  let fileCount = 0;
  for (const sourceRoot of sourceRoots) {
    for (const filePath of sourceFiles(path.join(repoRoot, sourceRoot))) {
      fileCount += 1;
      const source = readFileSync(filePath, "utf8");
      const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, filePath.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      for (const { text, position } of visibleTexts(sourceFile)) {
        for (const { rule, pattern, reason } of DECISION_VOCABULARY_RULES) {
          const match = pattern.exec(text);
          if (!match) continue;
          const { line } = sourceFile.getLineAndCharacterOfPosition(position);
          findings.push({ path: normalizedPath(repoRoot, filePath), line: line + 1, rule, phrase: match[0], reason });
        }
      }
    }
  }
  return { findings, fileCount };
}
