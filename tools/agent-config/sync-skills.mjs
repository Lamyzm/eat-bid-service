/** @module 책임: `.agents/skills`를 canonical로 두고 `.claude/skills`를 byte-exact projection으로 생성·검증한다. */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const compare = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

function listFiles(root) {
  const files = [];
  const walk = (directory) => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(target);
      else if (entry.isFile()) files.push(path.relative(root, target).replaceAll("\\", "/"));
    }
  };
  walk(root);
  return files.sort(compare);
}

function listEmptyDirectories(root) {
  const empty = [];
  const walk = (directory) => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return false;
    }
    let hasContent = false;
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) hasContent = walk(target) || hasContent;
      else hasContent = true;
    }
    if (!hasContent && directory !== root) empty.push(directory);
    return hasContent;
  };
  walk(root);
  return empty;
}

/** symlink 대신 byte 비교를 쓴다. Windows와 Git 설정 차이로 symlink는 projection 보장이 되지 않는다. */
export function inspectSkillProjection({ canonicalRoot, projectionRoot }) {
  const canonical = listFiles(canonicalRoot);
  const projection = new Set(listFiles(projectionRoot));
  const missing = [];
  const drifted = [];
  const synced = [];
  for (const file of canonical) {
    if (!projection.has(file)) {
      missing.push(file);
      continue;
    }
    const left = readFileSync(path.join(canonicalRoot, file));
    const right = readFileSync(path.join(projectionRoot, file));
    (left.equals(right) ? synced : drifted).push(file);
  }
  const canonicalSet = new Set(canonical);
  const extra = [...projection].filter((file) => !canonicalSet.has(file)).sort(compare);
  return {
    ok: missing.length === 0 && extra.length === 0 && drifted.length === 0,
    missing,
    extra,
    drifted,
    synced,
  };
}

export function writeSkillProjection({ canonicalRoot, projectionRoot }) {
  const report = inspectSkillProjection({ canonicalRoot, projectionRoot });
  const written = [...report.missing, ...report.drifted].sort(compare);
  for (const file of written) {
    const target = path.join(projectionRoot, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, readFileSync(path.join(canonicalRoot, file)));
  }
  for (const file of report.extra) rmSync(path.join(projectionRoot, file), { force: true });
  for (const directory of listEmptyDirectories(projectionRoot)) {
    rmSync(directory, { recursive: true, force: true });
  }
  return { written, removed: report.extra };
}

function main() {
  const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
  const roots = {
    canonicalRoot: path.join(repoRoot, ".agents", "skills"),
    projectionRoot: path.join(repoRoot, ".claude", "skills"),
  };
  if (process.argv.includes("--write")) {
    const result = writeSkillProjection(roots);
    console.log(
      `skill projection을 갱신했습니다. 작성 ${result.written.length}개, 제거 ${result.removed.length}개`,
    );
    return;
  }
  const report = inspectSkillProjection(roots);
  if (report.ok) {
    console.log(`skill projection 검사가 통과했습니다. ${report.synced.length}개 파일이 canonical과 같습니다.`);
    return;
  }
  console.error("skill projection 검사가 실패했습니다. `pnpm agent:skills:write`로 재생성하십시오.");
  for (const file of report.missing) console.error(`- 누락: ${file}`);
  for (const file of report.extra) console.error(`- projection에만 존재: ${file}`);
  for (const file of report.drifted) console.error(`- drift: ${file}`);
  process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
