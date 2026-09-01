/** @module 책임: production 모듈의 한국어 책임 설명과 삭제 전용 legacy ledger를 검사한다. */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const BASELINE_VERSION = "eatbid.korean-module-comments/v1";
const DEFAULT_LEGACY_COMMIT = "e7fdcd2";
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

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function git(repoRoot, args, options = {}) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

function trackedAndUntrackedFiles(repoRoot) {
  return git(repoRoot, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"])
    .split("\0")
    .filter(Boolean)
    .map((item) => item.replaceAll("\\", "/"))
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
  const normalized = file.replaceAll("\\", "/");
  if (excludedPath.test(normalized) || excludedFile.test(path.basename(normalized))) return false;
  if (/(?:^|\/)schemas?(?:\/|$)/iu.test(normalized)) return false;
  return !pureBarrel(normalized, source);
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

function rawInspection(repoRoot) {
  const files = trackedAndUntrackedFiles(repoRoot);
  const sources = new Map(
    files.map((file) => [file, readFileSync(path.join(repoRoot, file), "utf8")]),
  );
  const eligibleFiles = files.filter((file) => eligible(file, sources.get(file)));
  const javascriptViolations = eligibleFiles
    .filter((file) => !pythonExtension.test(file))
    .map((file) => inspectJavaScript(file, sources.get(file)))
    .filter(Boolean);
  const pythonResults = runPythonChecker(
    repoRoot,
    eligibleFiles.filter((file) => pythonExtension.test(file)),
  );
  const pythonViolations = pythonResults
    .filter((item) => !item.valid)
    .map(({ path: file, message }) => ({ path: file, message }));
  return {
    eligibleFiles,
    sources,
    violations: [...javascriptViolations, ...pythonViolations].sort((left, right) =>
      compare(left.path, right.path),
    ),
  };
}

function resolvedCommit(repoRoot, legacyCommit) {
  return git(repoRoot, [
    "rev-parse",
    "--verify",
    "--end-of-options",
    `${legacyCommit}^{commit}`,
  ]).trim();
}

function legacyBlobs(repoRoot, commit, files) {
  if (files.length === 0) return new Map();
  if (files.some((file) => file.includes("\n")))
    throw new Error("줄바꿈을 포함한 source 경로는 검사할 수 없습니다.");
  const result = spawnSync("git", ["cat-file", "--batch"], {
    cwd: repoRoot,
    input: files.map((file) => `${commit}:${file}\n`).join(""),
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.toString("utf8"));

  const blobs = new Map();
  let offset = 0;
  for (const file of files) {
    const headerEnd = result.stdout.indexOf(0x0a, offset);
    if (headerEnd < 0) throw new Error("Git batch 응답 header가 완전하지 않습니다.");
    const header = result.stdout.subarray(offset, headerEnd).toString("utf8");
    offset = headerEnd + 1;
    if (header.endsWith(" missing")) {
      blobs.set(file, null);
      continue;
    }
    const match = header.match(/^[a-f0-9]+ blob (\d+)$/u);
    if (!match) throw new Error(`예상하지 못한 Git batch 응답입니다: ${header}`);
    const size = Number.parseInt(match[1], 10);
    blobs.set(file, result.stdout.subarray(offset, offset + size));
    offset += size + 1;
  }
  return blobs;
}

function readBaseline(baselinePath) {
  if (!existsSync(baselinePath))
    return { version: BASELINE_VERSION, legacyCommit: null, entries: [] };
  return JSON.parse(readFileSync(baselinePath, "utf8"));
}

function validBaselineEntries(repoRoot, baseline, legacyCommit) {
  const failures = [];
  if (
    baseline.version !== BASELINE_VERSION ||
    baseline.legacyCommit !== legacyCommit ||
    !Array.isArray(baseline.entries)
  ) {
    return {
      entries: new Map(),
      failures: ["legacy ledger 형식이나 기준 commit이 유효하지 않습니다."],
    };
  }
  const entries = new Map();
  const paths = baseline.entries.flatMap((entry) =>
    typeof entry?.path === "string" ? [entry.path] : [],
  );
  const blobs = legacyBlobs(repoRoot, legacyCommit, paths);
  for (const entry of baseline.entries) {
    const blob = typeof entry?.path === "string" ? blobs.get(entry.path) : null;
    if (!blob || entry.sha256 !== sha256(blob))
      failures.push(`기준 commit으로 증명되지 않은 legacy entry: ${entry?.path ?? "unknown"}`);
    else entries.set(entry.path, entry.sha256);
  }
  return { entries, failures };
}

/** 신규·변경 production 모듈의 설명 누락과 ledger 위변조를 함께 검사한다. */
export function inspectKoreanComments({
  repoRoot,
  baselinePath,
  legacyCommit = DEFAULT_LEGACY_COMMIT,
}) {
  const root = path.resolve(repoRoot);
  const commit = resolvedCommit(root, legacyCommit);
  const inspection = rawInspection(root);
  const baseline = readBaseline(path.resolve(baselinePath));
  const validated = validBaselineEntries(root, baseline, commit);
  const violations = inspection.violations.filter((violation) => {
    const sourceHash = sha256(Buffer.from(inspection.sources.get(violation.path), "utf8"));
    return validated.entries.get(violation.path) !== sourceHash;
  });
  return {
    inspectedCount: inspection.eligibleFiles.length,
    violations,
    baselineFailures: validated.failures,
  };
}

/** 기준 commit과 현재 byte가 완전히 같은 기존 부채만 한 번 ledger로 생성한다. */
export function writeKoreanCommentBaseline({
  repoRoot,
  baselinePath,
  legacyCommit = DEFAULT_LEGACY_COMMIT,
}) {
  const root = path.resolve(repoRoot);
  const target = path.resolve(baselinePath);
  if (existsSync(target)) throw new Error(`한국어 책임 주석 baseline이 이미 존재합니다: ${target}`);
  const commit = resolvedCommit(root, legacyCommit);
  const inspection = rawInspection(root);
  const blobs = legacyBlobs(
    root,
    commit,
    inspection.violations.map((violation) => violation.path),
  );
  const entries = inspection.violations.flatMap((violation) => {
    const current = Buffer.from(inspection.sources.get(violation.path), "utf8");
    const legacy = blobs.get(violation.path);
    return legacy && current.equals(legacy)
      ? [{ path: violation.path, sha256: sha256(current) }]
      : [];
  });
  const baseline = { version: BASELINE_VERSION, legacyCommit: commit, entries };
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(baseline, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  return baseline;
}

function main() {
  const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
  const baselinePath = path.join(moduleDirectory, "korean-comment-legacy-baseline.json");
  if (process.argv.includes("--write-baseline")) {
    const baseline = writeKoreanCommentBaseline({ repoRoot, baselinePath });
    console.log(`한국어 책임 주석 legacy ${baseline.entries.length}개를 기록했습니다.`);
    return;
  }
  const report = inspectKoreanComments({ repoRoot, baselinePath });
  if (report.baselineFailures.length || report.violations.length) {
    console.error("한국어 module 책임 주석 검사가 실패했습니다:");
    for (const message of report.baselineFailures) console.error(`- baseline: ${message}`);
    for (const violation of report.violations)
      console.error(`- ${violation.path}: ${violation.message}`);
    process.exitCode = 1;
    return;
  }
  console.log(`한국어 module 책임 주석 검사가 통과했습니다. production ${report.inspectedCount}개`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
