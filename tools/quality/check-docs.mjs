/** @module 책임: 권위 문서의 canonical_for 유일성·지도 도달성·ADR/PDR 대체 관계·상대 링크를 전체에서 판정하고, frontmatter 머리말은 ADR 0042의 변경 범위 규칙으로 신규·수정 문서에만 요구한다. */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { changedScope, describeScope } from "../git/changed-paths.mjs";

// 지도의 뿌리 셋이다. AGENTS → ARCHITECTURE → docs/README 순서로 읽으라는 필수 읽기 순서와 같다.
const ROOT_DOCUMENTS = ["AGENTS.md", "ARCHITECTURE.md", "docs/README.md"];
// CLAUDE.md가 `@AGENTS.md`로 그대로 import하고 Codex도 첫 줄부터 읽는 파일이라 YAML 머리말을 두면 매 세션 지침에 메타가 섞인다. 링크·도달성 검사만 한다.
const FRONTMATTER_EXEMPT = new Set(["AGENTS.md", "ARCHITECTURE.md"]);
const TARGET_DIRECTORIES = [
  "docs/product",
  "docs/architecture",
  "docs/operations",
  "docs/adr",
  "docs/governance",
];
// 시안·목업·생성기 산출물은 문서가 아니라 자산이라 frontmatter를 요구하지 않는다.
const EXCLUDED_DIRECTORY = /(?:^|\/)(?:prototypes?|mockups|design-generators)(?:\/|$)/u;
const YAML_REQUIRED_FIELDS = ["id", "status", "canonical_for", "last_reviewed", "review_trigger"];
const YAML_STATUSES = new Set(["active", "draft", "exploration", "superseded", "archived", "evidence"]);
const ADR_STATUSES = new Set(["Proposed", "Accepted", "Deprecated", "Superseded"]);
const PDR_STATUSES = new Set(["Proposed", "Active", "Superseded"]);
// ADR은 "2026-09-04 (2026-09-09 개정·확정)"처럼 날짜 뒤에 메모를 붙이므로 앞머리만 날짜면 된다.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:\s|$)/u;
const compare = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

function git(repoRoot, args) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
}

function normalize(file) {
  return file.replaceAll("\\", "/");
}

function markdownFiles(repoRoot) {
  return git(repoRoot, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"])
    .split("\0")
    .filter(Boolean)
    .map(normalize)
    .filter((file) => file.endsWith(".md") && existsSync(path.join(repoRoot, file)))
    .sort(compare);
}

function isTarget(file) {
  if (ROOT_DOCUMENTS.includes(file)) return true;
  if (EXCLUDED_DIRECTORY.test(file)) return false;
  return TARGET_DIRECTORIES.some((directory) => file.startsWith(`${directory}/`));
}

function isRecord(file) {
  return /^docs\/(?:adr|product\/decisions)\/\d{4}-[^/]+\.md$/u.test(file);
}

function recordKind(file) {
  return file.startsWith("docs/adr/") ? "ADR" : "PDR";
}

function recordNumber(file) {
  return path.basename(file).slice(0, 4);
}

function normalizeSource(source) {
  return source.replace(/^﻿/u, "").replaceAll("\r\n", "\n");
}

/** frontmatter는 평평한 `key: value`만 쓰므로 YAML 파서 없이 그 형태만 읽는다. 중첩·목록은 값으로 취급하지 않는다. */
function parseYamlFrontmatter(source) {
  const lines = normalizeSource(source).split("\n");
  if (lines[0] !== "---") return null;
  const end = lines.indexOf("---", 1);
  if (end < 0) return null;
  const fields = new Map();
  for (const line of lines.slice(1, end)) {
    const match = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/u);
    if (match) fields.set(match[1], match[2].trim().replace(/^["']|["']$/gu, ""));
  }
  return fields;
}

/** ADR·PDR은 `- Status:` 목록 머리말을 쓴다. 첫 heading 뒤 첫 목록 블록만 읽는다. */
function parseRecordHeader(source) {
  const lines = normalizeSource(source).split("\n");
  const fields = new Map();
  let started = false;
  for (const line of lines) {
    const match = line.match(/^- ([A-Za-z][A-Za-z -]*?):\s*(.*)$/u);
    if (match) {
      started = true;
      fields.set(match[1].trim().toLowerCase().replace(/\s+/gu, "-"), match[2].trim());
    } else if (started && line.trim() !== "" && !line.startsWith("  ")) break;
  }
  return fields;
}

/** "Supersedes: 0020"이나 링크 하나뿐일 때만 전체 대체다. "…의 일부만 대체" 같은 문장은 부분 대체라 양방향을 요구하지 않는다. */
function fullSupersession(value) {
  if (!value) return null;
  const text = value.trim().replace(/[.。]$/u, "").trim();
  const bare = text.match(/^(?:ADR |PDR )?(\d{4})$/u);
  if (bare) return bare[1];
  const link = text.match(/^\[[^\]]*\]\((\d{4})-[^)]*\.md\)$/u);
  return link ? link[1] : null;
}

function headingSlug(text) {
  const plain = text
    .replace(/`([^`]*)`/gu, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/[*_~]/gu, "")
    .trim()
    .toLowerCase();
  return plain.replace(/[^\p{L}\p{N}\s-]/gu, "").replace(/\s/gu, "-");
}

function headingAnchors(source) {
  const counts = new Map();
  const anchors = new Set();
  let inFence = false;
  for (const line of normalizeSource(source).split("\n")) {
    if (/^\s*(?:```|~~~)/u.test(line)) inFence = !inFence;
    if (inFence) continue;
    const match = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/u);
    if (!match) continue;
    const base = headingSlug(match[1]);
    const seen = counts.get(base) ?? 0;
    counts.set(base, seen + 1);
    anchors.add(seen === 0 ? base : `${base}-${seen}`);
  }
  return anchors;
}

function relativeLinks(source) {
  const links = [];
  let inFence = false;
  for (const line of normalizeSource(source).split("\n")) {
    if (/^\s*(?:```|~~~)/u.test(line)) inFence = !inFence;
    if (inFence) continue;
    // Next route group 경로 `(workspace)`처럼 균형 잡힌 괄호 한 겹과 `<…>` 감싼 경로를 GitHub와 같이 허용한다.
    for (const match of line.matchAll(/\]\((?:<([^>]+)>|((?:[^()\s]|\([^()\s]*\))+))(?:\s+"[^"]*")?\)/gu)) {
      const target = match[1] ?? match[2];
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/iu.test(target)) continue;
      links.push(target);
    }
  }
  return links;
}

function resolveLink(file, target) {
  const [rawPath, anchor] = target.split("#");
  const decoded = decodeURIComponent(rawPath);
  const resolved = normalize(path.posix.normalize(path.posix.join(path.posix.dirname(file), decoded)));
  return { path: resolved, anchor: anchor ? decodeURIComponent(anchor).toLowerCase() : null };
}

/** 머리말 검사와 상태·대체 메타 추출을 함께 한다. 메타는 전체 규칙에, 메시지는 변경 범위 규칙에 쓴다. */
function inspectHeader(file, source) {
  const messages = [];
  const meta = { file, status: null, canonicalFor: null, supersedes: null, supersededBy: null };
  if (isRecord(file)) {
    const kind = recordKind(file);
    const header = parseRecordHeader(source);
    const allowed = kind === "ADR" ? ADR_STATUSES : PDR_STATUSES;
    const status = header.get("status");
    if (!status) messages.push(`${kind} 머리말에 'Status:'가 필요합니다.`);
    else if (!allowed.has(status))
      messages.push(`${kind} Status '${status}'는 허용 값(${[...allowed].join(", ")})이 아닙니다.`);
    if (!ISO_DATE.test(header.get("date") ?? ""))
      messages.push(`${kind} 머리말의 'Date:'는 YYYY-MM-DD로 시작해야 합니다.`);
    if (!header.has("supersedes")) messages.push(`${kind} 머리말에 'Supersedes:'가 필요합니다.`);
    const supersededBy = header.get("superseded-by") ?? null;
    if (kind === "PDR" && supersededBy === null)
      messages.push("PDR 머리말에 'Superseded-by:'가 필요합니다(없으면 '없음').");
    meta.status = status ?? null;
    meta.supersedes = fullSupersession(header.get("supersedes"));
    meta.supersededBy = fullSupersession(supersededBy);
    if (status === "Superseded" && meta.supersededBy === null)
      messages.push(`${kind} Status가 Superseded이면 'Superseded-by:'에 대체한 문서 번호나 링크 하나를 적어야 합니다.`);
    return { messages, meta };
  }
  const fields = parseYamlFrontmatter(source);
  if (!fields) {
    messages.push(`YAML frontmatter(${YAML_REQUIRED_FIELDS.join(", ")})가 필요합니다.`);
    return { messages, meta };
  }
  const missing = YAML_REQUIRED_FIELDS.filter((field) => !fields.get(field));
  if (missing.length) messages.push(`frontmatter 필드가 비었습니다: ${missing.join(", ")}`);
  const status = fields.get("status");
  if (status && !YAML_STATUSES.has(status))
    messages.push(`status '${status}'는 허용 값(${[...YAML_STATUSES].join(", ")})이 아닙니다.`);
  if (fields.get("last_reviewed") && !ISO_DATE.test(fields.get("last_reviewed")))
    messages.push("last_reviewed는 YYYY-MM-DD 형식이어야 합니다.");
  meta.status = status ?? null;
  meta.canonicalFor = fields.get("canonical_for") ?? null;
  return { messages, meta };
}

function reachableFromRoots(sources) {
  const reachable = new Set();
  const queue = ROOT_DOCUMENTS.filter((root) => sources.has(root));
  while (queue.length) {
    const file = queue.shift();
    if (reachable.has(file)) continue;
    reachable.add(file);
    for (const target of relativeLinks(sources.get(file))) {
      const resolved = resolveLink(file, target).path;
      if (sources.has(resolved) && !reachable.has(resolved)) queue.push(resolved);
    }
  }
  return reachable;
}

/**
 * 머리말 규칙은 ADR 0042의 변경 범위 규칙이라 `changedPaths` 안의 대상 문서에만 적용한다. 나머지 네 규칙은
 * 예외가 없으므로 항상 전체 문서에서 판정한다. `changedPaths`가 없으면 머리말도 전체에서 검사하며 이는
 * 감사(`--all`)와 기준 미정 경고에만 쓴다.
 */
export function inspectDocs({ repoRoot, changedPaths }) {
  const root = path.resolve(repoRoot);
  const files = markdownFiles(root);
  const sources = new Map(files.map((file) => [file, readFileSync(path.join(root, file), "utf8")]));
  const targets = files.filter(isTarget);
  const changed = changedPaths ? new Set([...changedPaths].map(normalize)) : null;
  const headerViolations = [];
  const violations = [];
  const report = (file, message) => violations.push({ path: file, message });
  const metas = new Map();

  for (const file of targets) {
    if (FRONTMATTER_EXEMPT.has(file)) continue;
    const { messages, meta } = inspectHeader(file, sources.get(file));
    metas.set(file, meta);
    if (changed && !changed.has(file)) continue;
    for (const message of messages) headerViolations.push({ path: file, message });
  }

  // canonical_for는 대상 밖 evidence 문서도 선언하므로 유일성은 docs 전체에서 본다.
  const canonicalOwners = new Map();
  for (const file of files) {
    const fields = isRecord(file) ? null : parseYamlFrontmatter(sources.get(file));
    const value = fields?.get("canonical_for");
    if (!value || value === "none") continue;
    if (!canonicalOwners.has(value)) canonicalOwners.set(value, []);
    canonicalOwners.get(value).push(file);
  }
  for (const [value, owners] of canonicalOwners) {
    if (owners.length < 2) continue;
    for (const file of owners)
      report(file, `canonical_for '${value}'를 ${owners.filter((other) => other !== file).join(", ")}와 함께 선언했습니다. 권위 문서는 질문당 하나입니다.`);
  }

  const reachable = reachableFromRoots(sources);
  for (const [file, meta] of metas) {
    const active =
      meta.status === "active" ||
      (isRecord(file) && (meta.status === "Accepted" || meta.status === "Active"));
    if (active && !reachable.has(file))
      report(file, "active 문서인데 AGENTS.md → ARCHITECTURE.md → docs/README.md 지도에서 링크로 도달할 수 없습니다.");
  }

  const records = new Map();
  for (const [file, meta] of metas) if (isRecord(file)) records.set(`${recordKind(file)}:${recordNumber(file)}`, meta);
  for (const [key, meta] of records) {
    const kind = key.slice(0, 3);
    if (meta.supersedes) {
      const target = records.get(`${kind}:${meta.supersedes}`);
      if (!target) report(meta.file, `Supersedes가 가리키는 ${kind} ${meta.supersedes}가 없습니다.`);
      else {
        if (target.status !== "Superseded")
          report(target.file, `${kind} ${recordNumber(meta.file)}가 이 문서를 대체한다고 선언했지만 Status가 Superseded가 아닙니다.`);
        if (target.supersededBy !== recordNumber(meta.file))
          report(target.file, `${kind} ${recordNumber(meta.file)}가 이 문서를 대체하므로 'Superseded-by:'에 ${recordNumber(meta.file)}을 적어야 합니다.`);
      }
    }
    if (meta.supersededBy) {
      const successor = records.get(`${kind}:${meta.supersededBy}`);
      if (!successor) report(meta.file, `Superseded-by가 가리키는 ${kind} ${meta.supersededBy}가 없습니다.`);
      else if (successor.supersedes !== recordNumber(meta.file))
        report(successor.file, `${kind} ${recordNumber(meta.file)}이 이 문서로 대체됐다고 선언했으므로 'Supersedes:'에 ${recordNumber(meta.file)}을 적어야 합니다.`);
    }
  }

  const anchorCache = new Map();
  const anchorsOf = (file) => {
    if (!anchorCache.has(file)) anchorCache.set(file, headingAnchors(sources.get(file)));
    return anchorCache.get(file);
  };
  for (const file of targets) {
    for (const target of relativeLinks(sources.get(file))) {
      const link = resolveLink(file, target);
      if (!existsSync(path.join(root, link.path))) {
        report(file, `상대 링크 '${target}'가 가리키는 파일이 없습니다.`);
        continue;
      }
      if (link.anchor && sources.has(link.path) && !anchorsOf(link.path).has(link.anchor))
        report(file, `상대 링크 '${target}'의 앵커가 대상 문서 heading에 없습니다.`);
    }
  }

  const sortViolations = (list) =>
    list.sort((left, right) => compare(left.path, right.path) || compare(left.message, right.message));
  return {
    inspectedCount: targets.length,
    headerInspectedCount: targets.filter((file) => !FRONTMATTER_EXEMPT.has(file) && (!changed || changed.has(file))).length,
    headerViolations: sortViolations(headerViolations),
    violations: sortViolations(violations),
  };
}

function printViolations(list, log) {
  for (const violation of list) log(`- ${violation.path}: ${violation.message}`);
}

function main() {
  const repoRoot = process.env.DOCS_CHECK_ROOT
    ? path.resolve(process.env.DOCS_CHECK_ROOT)
    : fileURLToPath(new URL("../../", import.meta.url));
  const scope = changedScope({ repoRoot });
  if (scope.mode === "unresolved") {
    // 기준이 없으면 무엇이 "신규·수정"인지 말할 수 없다. ADR 0042대로 머리말 규칙만 경고로 낮추고
    // 예외 없는 네 규칙은 그대로 판정한다. 실패 판정을 원하면 `--base <ref>`를 명시한다.
    const report = inspectDocs({ repoRoot });
    console.warn(`경고: ${scope.reason}`);
    console.warn(
      `대상 문서 ${report.inspectedCount}개 전체의 머리말을 검사했고 누락 ${report.headerViolations.length}개는 실패로 세지 않습니다. --base <ref>로 기준을 지정하면 실패로 판정합니다.`,
    );
    printViolations(report.headerViolations, console.warn);
    if (report.violations.length) {
      console.error("문서 위계 검사가 실패했습니다(범위: 전체):");
      printViolations(report.violations, console.error);
      process.exitCode = 1;
      return;
    }
    console.log("문서 위계 검사를 경고로 마쳤습니다.");
    return;
  }
  const report = inspectDocs({
    repoRoot,
    changedPaths: scope.mode === "changed" ? scope.paths : undefined,
  });
  const failures = [...report.headerViolations, ...report.violations];
  if (failures.length) {
    console.error(`문서 위계 검사가 실패했습니다(${describeScope(scope)}):`);
    printViolations(failures, console.error);
    process.exitCode = 1;
    return;
  }
  console.log(
    `문서 위계 검사가 통과했습니다. ${describeScope(scope)}, 머리말 ${report.headerInspectedCount}개, 전체 규칙 ${report.inspectedCount}개`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
