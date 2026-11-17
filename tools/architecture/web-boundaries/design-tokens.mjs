/**
 * @module 책임: Web 화면 토대(#240)를 우회하는 글자값을 찾는다 — 초록 계열 클래스, 토큰 파일 밖 색 글자값, 테마 파일 수, 임의 글자
 * 크기·임의 폭, 가운데 정렬로 화면 틀을 손으로 다시 짓는 자리, 토스트·숫자 표기의 주인 밖 사용. 옛 화면의 위반은 기준 목록에서
 * 줄어들기만 하고(ADR 0075 방식), 주인이 하나인 규칙과 테마 수는 예외 없이 판정한다.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { codePointCompare, isTestOrFixture, normalizedPath } from "./policy.mjs";

export const DESIGN_TOKEN_RULES = Object.freeze({
  GREEN_CLASS: "color-green-class",
  COLOR_LITERAL: "color-literal",
  THEME_FILE_COUNT: "theme-file-count",
  TEXT_ARBITRARY_SIZE: "text-arbitrary-size",
  ARBITRARY_WIDTH: "arbitrary-width",
  FRAME_BYPASS: "frame-bypass",
  TOAST_OWNER: "toast-owner",
  NUMBER_FORMAT_OWNER: "number-format-owner",
});

// 옛 화면에 이미 있는 위반은 그 화면을 지울 때 함께 사라진다. 지울 화면을 손보지 않으려고 기준 목록에 싣는다.
export const DESIGN_BASELINED_RULES = Object.freeze(
  new Set([
    DESIGN_TOKEN_RULES.GREEN_CLASS,
    DESIGN_TOKEN_RULES.COLOR_LITERAL,
    DESIGN_TOKEN_RULES.TEXT_ARBITRARY_SIZE,
    DESIGN_TOKEN_RULES.ARBITRARY_WIDTH,
    DESIGN_TOKEN_RULES.FRAME_BYPASS,
    DESIGN_TOKEN_RULES.NUMBER_FORMAT_OWNER,
  ]),
);

export const THEME_DIRECTORY = "apps/web/src/styles/themes";
// 색 글자값이 살 수 있는 자리: 테마 파일 하나와, CSS 변수를 못 읽는 meta theme-color용 거울(시험이 테마 파일과 같은지 단언한다).
const COLOR_LITERAL_OWNERS = new Set(["apps/web/src/shell/theme/meta-theme-color.ts"]);
const TOAST_OWNERS = new Set(["apps/web/src/shared/ui/notify.ts", "apps/web/src/shared/ui/sonner.tsx"]);
const NUMBER_FORMAT_OWNER = "apps/web/src/shared/lib/number-format.ts";

const GREEN_CLASS = /(?:^|[\s:'"`!(])(?:bg|text|border|ring|fill|stroke|from|via|to|outline|decoration|divide|accent|caret|shadow|placeholder)-(?:green|emerald|lime|teal)-/;
// 색 글자값: #rgb·#rgba·#rrggbb·#rrggbbaa와 색 함수. 앞뒤가 낱말 글자면 색이 아니라 이름(`#add-button`)이다.
const COLOR_LITERAL = /(?:^|[^\w&-])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])|\b(?:rgba?|hsla?|hwb|oklch|oklab|lab|lch|color)\(/i;
const TEXT_ARBITRARY_SIZE = /(?:^|[\s:'"`!])text-\[\d+(?:\.\d+)?(?:px|rem|em)\]/;
const ARBITRARY_WIDTH = /(?:^|[\s:'"`!])(?:min-|max-)?w-\[\d+(?:\.\d+)?(?:px|rem|em|ch)\]/;
const NUMBER_FORMAT = /\btoLocaleString\s*\(|\bIntl\.NumberFormat\b/;

function walkFiles(root, directory, accept) {
  const out = [];
  const visit = (entry) => {
    if (!existsSync(entry)) return;
    if (statSync(entry).isDirectory()) {
      if (!["node_modules", ".next", "dist", "coverage"].includes(path.basename(entry))) for (const child of readdirSync(entry)) visit(path.join(entry, child));
    } else if (accept(entry)) out.push(entry);
  };
  visit(directory);
  return out.sort(codePointCompare);
}

/** TS·TSX에서 사람이 쓴 글자값(문자열·템플릿 조각·JSX 글)과 import 이름을 모은다. 주석은 보지 않는다 — 이슈 번호 `#228`이 색으로 읽히지 않게. */
function scanTypeScript(file, text) {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const strings = [];
  const imports = [];
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
      imports.push(node.moduleSpecifier.text);
      return;
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) {
      imports.push(node.arguments[0].text);
      return;
    }
    if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node) || ts.isJsxText(node)) strings.push(node.text);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { strings, imports, code: text };
}

function stripCssComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** 한 클래스 묶음 안에 가운데 정렬과 최대 폭을 함께 고른 자리. 화면 틀은 `PageFrame`이 소유한다. */
function bypassesFrame(value) {
  return /(?:^|\s)mx-auto(?:\s|$)/.test(value) && /(?:^|[\s:])max-w-/.test(value);
}

export function designTokenFindings(root, sourceRoot) {
  const findings = [];
  const add = (rule, displayPath, reason) => findings.push({ rule, path: displayPath, kind: "SourceFile", reason, key: displayPath });

  const themeDirectory = path.join(root, THEME_DIRECTORY);
  const themeFiles = walkFiles(root, themeDirectory, (entry) => entry.endsWith(".css")).map((entry) => normalizedPath(root, entry));
  // styles 층이 없는 트리(검사기 시험의 작은 표본)에는 테마를 따질 자리가 없다. styles가 있으면 테마는 정확히 하나다.
  if (existsSync(path.join(root, "apps/web/src/styles")) && themeFiles.length !== 1) {
    findings.push({
      rule: DESIGN_TOKEN_RULES.THEME_FILE_COUNT,
      path: THEME_DIRECTORY,
      kind: "Directory",
      reason: `테마 파일은 하나여야 합니다(지금 ${themeFiles.length}개: ${themeFiles.join(", ") || "없음"}). 색 토큰의 원천이 둘이면 시안과 화면이 다른 색을 베낍니다(#240).`,
    });
  }
  const colorOwners = new Set([...COLOR_LITERAL_OWNERS, ...(themeFiles.length === 1 ? themeFiles : [])]);

  const files = walkFiles(root, sourceRoot, (entry) => /\.(?:[cm]?tsx?|css)$/i.test(entry) && !/\.d\.ts$/i.test(entry) && !isTestOrFixture(entry));
  for (const file of files) {
    const displayPath = normalizedPath(root, file);
    const text = readFileSync(file, "utf8");
    const isCss = file.endsWith(".css");
    const scanned = isCss ? { strings: [stripCssComments(text)], imports: [], code: stripCssComments(text) } : scanTypeScript(file, text);

    if (scanned.strings.some((value) => GREEN_CLASS.test(value))) add(DESIGN_TOKEN_RULES.GREEN_CLASS, displayPath, "초록 계열 클래스(green·emerald·lime·teal)는 쓰지 않습니다. 성공·낙찰도 브랜드 파랑이고 의미색은 주의·위험 둘뿐입니다(#240).");
    if (!colorOwners.has(displayPath) && scanned.strings.some((value) => COLOR_LITERAL.test(value))) add(DESIGN_TOKEN_RULES.COLOR_LITERAL, displayPath, `색 글자값(#hex·rgb()·oklch() …)은 테마 파일(${THEME_DIRECTORY}) 밖에 둘 수 없습니다. 토큰 이름(bg-primary·text-ink-3 …)을 쓰십시오.`);
    if (isCss) continue;
    if (scanned.strings.some((value) => TEXT_ARBITRARY_SIZE.test(value))) add(DESIGN_TOKEN_RULES.TEXT_ARBITRARY_SIZE, displayPath, "글자 크기는 네 단(text-label·text-body·text-title·text-value)만 씁니다. text-[Npx]로 크기를 손으로 고르지 않습니다.");
    if (scanned.strings.some((value) => ARBITRARY_WIDTH.test(value))) add(DESIGN_TOKEN_RULES.ARBITRARY_WIDTH, displayPath, "폭은 이름 붙은 폭(max-w-page·max-w-read·max-w-notice)이나 간격 단위로만 고릅니다. w-[Npx] 같은 임의 폭을 쓰지 않습니다.");
    if (scanned.strings.some(bypassesFrame)) add(DESIGN_TOKEN_RULES.FRAME_BYPASS, displayPath, "화면 틀(폭·왼쪽 붙임·여백)은 PageFrame이 소유합니다. mx-auto와 max-w-로 틀을 다시 짓지 않습니다.");
    if (displayPath !== NUMBER_FORMAT_OWNER && NUMBER_FORMAT.test(scanned.code)) add(DESIGN_TOKEN_RULES.NUMBER_FORMAT_OWNER, displayPath, "숫자 표기(쉼표·원·건·%)는 shared/lib/number-format.ts 하나가 소유합니다. toLocaleString·Intl.NumberFormat을 직접 부르지 않습니다.");
    if (!TOAST_OWNERS.has(displayPath) && scanned.imports.some((specifier) => specifier === "sonner" || specifier.startsWith("sonner/"))) add(DESIGN_TOKEN_RULES.TOAST_OWNER, displayPath, "토스트는 shared/ui/notify.ts 하나로만 띄웁니다. 누른 자리에서 보이는 결과(복사됨·저장됨)는 그 자리가 말합니다.");
  }
  return findings.sort((left, right) => codePointCompare(`${left.rule}\0${left.path}`, `${right.rule}\0${right.path}`));
}
