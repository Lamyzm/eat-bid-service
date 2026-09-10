/** @module 책임: 변경 범위 안 source가 `../` 한 단계를 넘는 상대 경로 import를 쓰지 않는지 판정하고, 별칭 해석기가 없어 대상에서 뺀 패키지와 그 편입 조건을 검사 결과에 드러낸다. */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

import { changedScope, describeScope } from "../git/changed-paths.mjs";

/** `./foo`와 `../foo`는 함께 바뀌는 이웃이라 허용하고 `../../foo`부터 막는다(ADR 0047 결정 1). */
export const MAX_UPWARD_DEPTH = 1;

const SOURCE_EXTENSION = /\.[cm]?[jt]sx?$/iu;
const compare = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

/**
 * 검사 대상과 위반 시 안내할 해결 방법이다. `alias`가 있는 scope는 그 별칭으로 바꾸라고 말하고,
 * 없는 scope는 `packages/domain`이 0을 달성한 방식(구조)으로 안내한다. ADR 0047 결정 2가 소유한다.
 */
export const TARGET_SCOPES = Object.freeze([
  {
    prefix: "apps/web/src/",
    // Next와 Turbopack이 소유하는 별칭이라 런타임 해석이 이미 보장된다. `src` 밖(e2e·scripts)은
    // Playwright·bun이 각자 해석하고 `@/` 사용 실적이 0이라 대상이 아니다.
    alias: { specifier: "@/", root: "apps/web/src/" },
    remedy: "`@/` 별칭으로 바꾸십시오",
  },
  {
    prefix: "packages/domain/src/",
    alias: undefined,
    remedy: "별칭이 없는 패키지이므로 'src/<영역>/<파일>' 2단계 배치를 유지해 '../' 한 단계로 닿게 하십시오",
  },
  {
    prefix: "packages/db/src/",
    alias: undefined,
    remedy: "별칭이 없는 패키지이므로 참조 대상을 '../' 한 단계 안으로 옮기거나 호출부를 그 옆에 두십시오",
  },
  {
    prefix: "tools/",
    alias: undefined,
    remedy: "별칭이 없는 경로이므로 'tools/<영역>/<파일>' 2단계 배치를 유지해 '../' 한 단계로 닿게 하십시오",
  },
]);

/**
 * 오늘 별칭을 쓸 수 없어 뺀 scope다. 조용히 빼면 다음 사람이 검사가 전부를 본다고 믿으므로 이유와 편입
 * 조건을 여기에 둔다. 조건이 충족되면 이 항목을 `TARGET_SCOPES`로 옮긴다(ADR 0047 결정 3).
 */
export const EXCLUDED_SCOPES = Object.freeze([
  {
    prefix: "apps/server/src/",
    reason: "commonjs + moduleResolution node라 tsc가 paths를 출력물에 다시 쓰지 않아 별칭이 런타임에 죽는다",
    condition: "ESM 전환이 끝나 module node16 아래 tsconfig.build.json typecheck가 오류 0이 될 때",
  },
  {
    prefix: "packages/contracts/src/",
    reason: "commonjs + moduleResolution node이고 src만 type module인 이중 형식이라 별칭 해석기가 없다",
    condition: "이중 형식을 정리하고 상대 import에 확장자를 붙이는 작업이 끝날 때",
  },
]);

/**
 * specifier가 거슬러 올라가는 최대 단계다. `./a/../../b`처럼 내려갔다 다시 올라가는 경로도 실제 해석과
 * 같게 세려고 세그먼트를 걸으며 최댓값을 잡는다. 상대 경로가 아니면 0이다.
 */
export function upwardDepth(specifier) {
  const normalized = specifier.replaceAll("\\", "/");
  if (!/^\.\.?(?:\/|$)/u.test(normalized)) return 0;
  let depth = 0;
  let deepest = 0;
  for (const segment of normalized.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      depth += 1;
      if (depth > deepest) deepest = depth;
    } else depth -= 1;
  }
  return deepest;
}

/** import·export·동적 import·require·import type의 module specifier만 모은다. 문자열 리터럴은 import가 아니다. */
export function moduleSpecifiers(file, source) {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const found = [];
  const push = (node) => {
    if (!ts.isStringLiteralLike(node)) return;
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    found.push({ text: node.text, line: line + 1 });
  };
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      push(node.moduleSpecifier);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      push(node.argument.literal);
    } else if (ts.isExternalModuleReference(node)) {
      push(node.expression);
    } else if (ts.isCallExpression(node)) {
      const dynamic = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const required = ts.isIdentifier(node.expression) && node.expression.text === "require";
      if ((dynamic || required) && node.arguments.length > 0) push(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function scopeOf(file) {
  return TARGET_SCOPES.find((scope) => file.startsWith(scope.prefix));
}

/** 별칭이 있는 scope면 그 specifier로 바꾼 제안을 만든다. 대상이 scope 밖으로 나가면 제안하지 않는다. */
function aliasSuggestion(scope, file, specifier) {
  if (!scope.alias) return undefined;
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
  if (!resolved.startsWith(scope.alias.root)) return undefined;
  return `${scope.alias.specifier}${resolved.slice(scope.alias.root.length)}`;
}

/**
 * `changedPaths`가 주어지면 그 안의 대상 파일만 본다. 생략하면 대상 scope 전체를 보며, 이는 감사(`--all`)와
 * 기준 미정 경고에만 쓴다(ADR 0042 결정 2·3과 같은 처리다).
 */
export function inspectImportDepth({ repoRoot, changedPaths, files }) {
  const root = path.resolve(repoRoot);
  const candidates = [...(changedPaths ?? files ?? [])].map((item) => item.replaceAll("\\", "/"));
  const targets = [...new Set(candidates)]
    .filter((item) => SOURCE_EXTENSION.test(item) && scopeOf(item) !== undefined)
    .filter((item) => existsSync(path.join(root, item)))
    .sort(compare);
  const violations = [];
  for (const file of targets) {
    const scope = scopeOf(file);
    const source = readFileSync(path.join(root, file), "utf8");
    for (const { text, line } of moduleSpecifiers(file, source)) {
      const depth = upwardDepth(text);
      if (depth <= MAX_UPWARD_DEPTH) continue;
      const suggestion = aliasSuggestion(scope, file, text);
      violations.push({
        path: file,
        line,
        specifier: text,
        depth,
        message:
          `'${text}'는 ${depth}단계를 거슬러 올라갑니다. '../' 한 단계까지만 허용합니다. ` +
          (suggestion ? `'${suggestion}'로 바꾸십시오.` : `${scope.remedy}.`),
      });
    }
  }
  return { inspectedCount: targets.length, violations };
}

/** 검사 대상이 아닌 이유를 결과 줄에 붙인다. 뺀 사실이 보이지 않으면 검사가 전부를 본다고 오해한다. */
export function describeExclusions() {
  return EXCLUDED_SCOPES.map((scope) => `${scope.prefix}(${scope.condition})`).join(", ");
}

function listTargetFiles(repoRoot) {
  return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  })
    .split("\0")
    .filter(Boolean)
    .map((item) => item.replaceAll("\\", "/"));
}

function report(scope, result) {
  if (result.violations.length === 0) {
    console.log(
      `상대 경로 import 깊이 검사가 통과했습니다. ${describeScope(scope)}, 대상 ${result.inspectedCount}개, 제외 ${describeExclusions()}`,
    );
    return true;
  }
  console.error(`상대 경로 import 깊이 검사가 실패했습니다(${describeScope(scope)}):`);
  for (const violation of result.violations) {
    console.error(`- ${violation.path}:${violation.line}: ${violation.message}`);
  }
  console.error(`검사에서 제외한 경로: ${describeExclusions()}`);
  return false;
}

function main() {
  const repoRoot = process.env.IMPORT_DEPTH_ROOT
    ? path.resolve(process.env.IMPORT_DEPTH_ROOT)
    : fileURLToPath(new URL("../../", import.meta.url));
  const scope = changedScope({ repoRoot });
  if (scope.mode === "unresolved") {
    // 기준이 없으면 무엇이 "신규·수정"인지 말할 수 없다. 실패로 만들면 shallow clone·source archive에서
    // gate가 자기 자신을 막고, 조용히 통과시키면 약해진 사실이 숨는다(ADR 0042 결정 2).
    const result = inspectImportDepth({ repoRoot, files: listTargetFiles(repoRoot) });
    console.warn(`경고: ${scope.reason}`);
    console.warn(
      `대상 ${result.inspectedCount}개 전체를 검사했고 위반 ${result.violations.length}개는 실패로 세지 않습니다. --base <ref>로 기준을 지정하면 실패로 판정합니다.`,
    );
    for (const violation of result.violations) console.warn(`- ${violation.path}:${violation.line}: ${violation.message}`);
    console.log("상대 경로 import 깊이 검사를 경고로 마쳤습니다.");
    return;
  }
  const result = inspectImportDepth({
    repoRoot,
    changedPaths: scope.mode === "changed" ? scope.paths : undefined,
    files: scope.mode === "all" ? listTargetFiles(repoRoot) : undefined,
  });
  if (!report(scope, result)) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
