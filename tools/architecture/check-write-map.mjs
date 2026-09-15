/** @module 책임: dataplane 모듈의 PostgreSQL·R2 쓰기 대상과 수집 쓰기 지도 문서가 모듈 단위로 일치하는지 검사한다. */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = process.env.WRITE_MAP_ROOT
  ? path.resolve(process.env.WRITE_MAP_ROOT)
  : fileURLToPath(new URL("../../", import.meta.url));
const sourceRoot = path.join(root, "apps", "dataplane", "src", "eatbid");
const documentPath = path.join(root, "docs", "architecture", "ingestion-write-map.md");

const SCHEMAS = "(?:ingest|core|mart|app|monitoring)";
// 리터럴 `schema.table`과 `schema.{name}` 같은 f-string 자리를 함께 잡는다. 자리표시자는 같은 모듈의
// `table="..."` 리터럴로 푼다. 이름을 실행 시점에만 아는 쓰기는 지도에 실을 수 없으므로 실패다.
const WRITE_STATEMENT = new RegExp(String.raw`\b(insert\s+into|update|delete\s+from)\s+(${SCHEMAS}\.(?:[a-z_]+|\{[a-z_]+\}))`, "giu");
const TABLE_LITERAL = /\btable\s*=\s*"([a-z_]+)"/gu;
const R2_WRITE = /\bput_object\(/u;
const TARGET = new RegExp(`^${SCHEMAS}\\.[a-z_]+$`, "u");

export const R2_TARGET = "R2";

function walkPython(directory, relativeTo) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "__pycache__" || entry.name.startsWith(".")) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkPython(absolute, relativeTo));
      continue;
    }
    if (!entry.name.endsWith(".py") || entry.name.startsWith("test_")) continue;
    files.push(path.relative(relativeTo, absolute).replaceAll("\\", "/"));
  }
  return files.sort();
}

/** 모듈 하나의 소스에서 쓰기 대상 집합을 뽑는다. 순수 함수라 fixture로 검증한다. */
export function writeTargetsOf(source) {
  const targets = new Set();
  const failures = [];
  const literals = [...source.matchAll(TABLE_LITERAL)].map((match) => match[1]);
  for (const match of source.matchAll(WRITE_STATEMENT)) {
    const target = match[2].toLowerCase();
    if (!target.includes("{")) {
      targets.add(target);
      continue;
    }
    const schema = target.slice(0, target.indexOf("."));
    if (literals.length === 0) {
      failures.push(`실행 시점 표 이름 쓰기(${target})는 \`table="..."\` 리터럴 없이는 지도에 실을 수 없습니다.`);
      continue;
    }
    for (const literal of literals) targets.add(`${schema}.${literal}`);
  }
  if (R2_WRITE.test(source)) targets.add(R2_TARGET);
  return { failures, targets };
}

export function scanSourceWrites(directory = sourceRoot) {
  const modules = new Map();
  const failures = [];
  for (const file of walkPython(directory, directory)) {
    const { failures: moduleFailures, targets } = writeTargetsOf(readFileSync(path.join(directory, file), "utf8"));
    for (const failure of moduleFailures) failures.push(`${file}: ${failure}`);
    if (targets.size > 0) modules.set(file, targets);
  }
  return { failures, modules };
}

// 표 셀 안의 `\|`는 구분자가 아니라 글자다. R2 키 패턴의 `{xml\|txt}`처럼 대상 표기 안에 들어온다.
function cellsOf(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return null;
  return trimmed
    .slice(1, trimmed.endsWith("|") && !trimmed.endsWith("\\|") ? -1 : undefined)
    .split(/(?<!\\)\|/u)
    .map((cell) => cell.replaceAll("\\|", "|").trim());
}

/**
 * 문서의 표에서 `모듈`·`쓰는 곳` 열을 읽는다. 같은 모듈이 여러 단계 행에 나오면 대상은 합집합이다.
 * 표 헤더 이름으로 열을 찾으므로 열 순서를 바꿔도 되지만 이름을 바꾸면 검사가 멈춘다.
 */
export function parseWriteMap(markdown) {
  const documented = new Map();
  const failures = [];
  let moduleIndex = -1;
  let targetIndex = -1;
  for (const line of markdown.replaceAll("\r\n", "\n").split("\n")) {
    const cells = cellsOf(line);
    if (!cells) {
      moduleIndex = -1;
      targetIndex = -1;
      continue;
    }
    if (cells.includes("모듈") && cells.includes("쓰는 곳")) {
      moduleIndex = cells.indexOf("모듈");
      targetIndex = cells.indexOf("쓰는 곳");
      continue;
    }
    if (moduleIndex < 0 || cells.every((cell) => /^:?-+:?$/u.test(cell))) continue;
    const module = cells[moduleIndex]?.match(/`([a-z0-9_/]+\.py)`/u)?.[1];
    if (!module) continue;
    const targets = documented.get(module) ?? new Set();
    for (const match of (cells[targetIndex] ?? "").matchAll(/`([^`]+)`/gu)) {
      const raw = match[1].trim();
      if (raw.startsWith("R2")) {
        targets.add(R2_TARGET);
        continue;
      }
      if (!TARGET.test(raw)) {
        failures.push(`지도의 대상 표기를 읽을 수 없습니다: ${module} → \`${raw}\``);
        continue;
      }
      targets.add(raw);
    }
    documented.set(module, targets);
  }
  if (documented.size === 0) failures.push("지도에서 `모듈`·`쓰는 곳` 열을 가진 표를 찾지 못했습니다.");
  return { documented, failures };
}

export function compareWriteMap({ documented, modules }) {
  const failures = [];
  for (const [module, targets] of modules) {
    const listed = documented.get(module);
    if (!listed) {
      failures.push(`지도에 없는 쓰기 모듈: ${module} → ${[...targets].sort().join(", ")}`);
      continue;
    }
    const missing = [...targets].filter((target) => !listed.has(target)).sort();
    const extra = [...listed].filter((target) => !targets.has(target)).sort();
    if (missing.length > 0) failures.push(`지도에 빠진 쓰기 대상: ${module} → ${missing.join(", ")}`);
    if (extra.length > 0) failures.push(`소스에 없는 쓰기 대상이 지도에 남아 있습니다: ${module} → ${extra.join(", ")}`);
  }
  for (const module of documented.keys()) {
    if (!modules.has(module)) failures.push(`지도에 남은 모듈이 더 이상 쓰지 않습니다: ${module}`);
  }
  return failures;
}

function main() {
  const { failures: scanFailures, modules } = scanSourceWrites();
  const { documented, failures: parseFailures } = parseWriteMap(readFileSync(documentPath, "utf8"));
  const failures = [...scanFailures, ...parseFailures, ...compareWriteMap({ documented, modules })];
  if (failures.length > 0) {
    for (const failure of failures) console.error(failure);
    console.error("docs/architecture/ingestion-write-map.md의 모듈별 표를 같은 커밋에서 고칩니다.");
    process.exitCode = 1;
    return;
  }
  const targets = new Set([...modules.values()].flatMap((set) => [...set]));
  console.log(`수집 쓰기 지도 검사가 통과했습니다. 쓰기 모듈 ${modules.size}개, 대상 ${targets.size}개가 문서와 같습니다.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
