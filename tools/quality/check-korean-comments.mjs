/** @module 책임: merge-base 이후 신규·수정된 production 모듈에 한국어 책임 설명이 있는지 검사하고, 기준을 못 찾은 경우를 실패 대신 경고로 드러낸다. */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

import { changedScope, describeScope } from "../git/changed-paths.mjs";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const pythonChecker = path.join(moduleDirectory, "check-python-korean-comments.py");
const sourceExtension = /\.(?:[cm]?[jt]sx?|py)$/iu;
const pythonExtension = /\.py$/iu;
const excludedPath =
  /(?:^|\/)(?:node_modules|dist|build|\.next|generated|__generated__|coverage|migrations|__fixtures__|fixtures?|e2e|tests?)(?:\/|$)|(?:^|\/)scripts\/cleanup-templates(?:\/|$)/iu;
const excludedFile =
  /(?:\.(?:test|spec)\.[cm]?[jt]sx?$|\.d\.ts$|\.config\.[cm]?[jt]s$|\.schema\.[cm]?[jt]s$)/iu;
const hangul = /[가-힣]/gu;
const genericDescription =
  /^(?:이\s*)?(?:모듈|코드|기능|해당\s*코드)(?:을|를)?\s*(?:설명|담당)(?:한다|합니다)?[.!]?$/u;
const compare = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

function git(repoRoot, args) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
}

function trackedAndUntrackedFiles(repoRoot) {
  return git(repoRoot, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"])
    .split("\0")
    .filter(Boolean)
    .map((item) => item.replaceAll("\\", "/"));
}

function sourceFiles(repoRoot, changedPaths) {
  const candidates = changedPaths ? [...changedPaths] : trackedAndUntrackedFiles(repoRoot);
  return [...new Set(candidates.map((item) => item.replaceAll("\\", "/")))]
    .filter((item) => sourceExtension.test(item) && existsSync(path.join(repoRoot, item)))
    .sort(compare);
}

function pureBarrel(file, source) {
  if (pythonExtension.test(file)) return path.basename(file) === "__init__.py";
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const statements = sourceFile.statements.filter(
    (statement) =>
      !(ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression)),
  );
  return (
    statements.length > 0 &&
    statements.every(
      (statement) =>
        ts.isImportDeclaration(statement) ||
        ts.isImportEqualsDeclaration(statement) ||
        ts.isExportDeclaration(statement) ||
        ts.isExportAssignment(statement),
    )
  );
}

function eligible(file, source) {
  if (excludedPath.test(file) || excludedFile.test(path.basename(file))) return false;
  if (/(?:^|\/)schemas?(?:\/|$)/iu.test(file)) return false;
  return !pureBarrel(file, source);
}

function meaningful(description) {
  const text = description.replace(/\s+/gu, " ").trim();
  return (text.match(hangul)?.length ?? 0) >= 6 && !genericDescription.test(text);
}

function commentAt(lines, start) {
  const first = lines[start]?.trimStart() ?? "";
  if (first.startsWith("//")) return first.slice(2).trim();
  if (!first.startsWith("/*")) return null;
  const block = [];
  for (let index = start; index < lines.length && index < start + 12; index += 1) {
    block.push(lines[index]);
    if (lines[index].includes("*/")) break;
  }
  if (!block.at(-1)?.includes("*/")) return null;
  return block
    .join("\n")
    .replace(/^\s*\/\*+|\*\/\s*$/gu, "")
    .replace(/^\s*\*\s?/gmu, " ")
    .trim();
}

function inspectJavaScript(file, source) {
  const lines = source
    .replace(/^\uFEFF/u, "")
    .replaceAll("\r\n", "\n")
    .split("\n");
  let index = lines[0]?.startsWith("#!") ? 1 : 0;
  const skipBlank = () => {
    while (index < lines.length && lines[index].trim() === "") index += 1;
  };
  skipBlank();
  let comment = commentAt(lines, index);
  if (comment === null) {
    while (/^\s*['"][^'"]+['"]\s*;?\s*$/u.test(lines[index] ?? "")) {
      index += 1;
      skipBlank();
    }
    comment = commentAt(lines, index);
  }
  const match = comment?.match(/@module\s+책임:\s*([\s\S]*)/u);
  if (!match)
    return { path: file, message: "import와 실행 코드 전에 '@module 책임:' 설명이 필요합니다." };
  if (!meaningful(match[1]))
    return { path: file, message: "module 책임은 구체적인 한국어 문장으로 작성해야 합니다." };
  return null;
}

function runPythonChecker(repoRoot, paths) {
  if (paths.length === 0) return [];
  const candidates = process.env.PYTHON
    ? [process.env.PYTHON]
    : process.platform === "win32"
      ? ["python", "python3"]
      : ["python3", "python"];
  for (const executable of candidates) {
    const result = spawnSync(executable, [pythonChecker], {
      encoding: "utf8",
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
      input: JSON.stringify({ repoRoot, paths }),
      windowsHide: true,
    });
    if (result.error?.code === "ENOENT") continue;
    if (result.error) throw result.error;
    if (result.status !== 0)
      throw new Error(
        result.stderr || `Python 책임 주석 검사기가 ${result.status}로 종료했습니다.`,
      );
    return JSON.parse(result.stdout).results;
  }
  throw new Error("Python 책임 주석 검사에 필요한 python/python3를 찾지 못했습니다.");
}

/**
 * 규칙 23은 신규·실질 변경 모듈에만 설명을 요구하므로 `changedPaths`가 주어지면 그 안의 production 모듈만
 * 검사한다. 생략하면 추적·미추적 source 전체를 검사하며, 이는 감사(`--all`)와 기준 미정 경고에만 쓴다.
 */
export function inspectKoreanComments({ repoRoot, changedPaths }) {
  const root = path.resolve(repoRoot);
  const files = sourceFiles(root, changedPaths);
  const sources = new Map(files.map((file) => [file, readFileSync(path.join(root, file), "utf8")]));
  const eligibleFiles = files.filter((file) => eligible(file, sources.get(file)));
  const javascriptViolations = eligibleFiles
    .filter((file) => !pythonExtension.test(file))
    .map((file) => inspectJavaScript(file, sources.get(file)))
    .filter(Boolean);
  const pythonViolations = runPythonChecker(
    root,
    eligibleFiles.filter((file) => pythonExtension.test(file)),
  )
    .filter((item) => !item.valid)
    .map(({ path: file, message }) => ({ path: file, message }));
  return {
    inspectedCount: eligibleFiles.length,
    violations: [...javascriptViolations, ...pythonViolations].sort((left, right) =>
      compare(left.path, right.path),
    ),
  };
}

function main() {
  const repoRoot = process.env.KOREAN_COMMENTS_ROOT
    ? path.resolve(process.env.KOREAN_COMMENTS_ROOT)
    : fileURLToPath(new URL("../../", import.meta.url));
  const scope = changedScope({ repoRoot });
  if (scope.mode === "unresolved") {
    // 기준이 없으면 무엇이 "신규·수정"인지 말할 수 없다. 실패로 만들면 shallow clone·source archive에서
    // gate가 자기 자신을 막고, 조용히 통과시키면 약해진 사실이 숨는다. 그래서 전체를 검사하되 결과를
    // 경고로 낮추고, 실패 판정을 원하면 `--base <ref>`를 명시하도록 안내한다.
    const report = inspectKoreanComments({ repoRoot });
    console.warn(`경고: ${scope.reason}`);
    console.warn(
      `production ${report.inspectedCount}개 전체를 검사했고 설명이 없는 ${report.violations.length}개는 실패로 세지 않습니다. --base <ref>로 기준을 지정하면 실패로 판정합니다.`,
    );
    for (const violation of report.violations) console.warn(`- ${violation.path}: ${violation.message}`);
    console.log("한국어 module 책임 주석 검사를 경고로 마쳤습니다.");
    return;
  }
  const report = inspectKoreanComments({
    repoRoot,
    changedPaths: scope.mode === "changed" ? scope.paths : undefined,
  });
  if (report.violations.length) {
    console.error(`한국어 module 책임 주석 검사가 실패했습니다(${describeScope(scope)}):`);
    for (const violation of report.violations)
      console.error(`- ${violation.path}: ${violation.message}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `한국어 module 책임 주석 검사가 통과했습니다. ${describeScope(scope)}, production ${report.inspectedCount}개`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
