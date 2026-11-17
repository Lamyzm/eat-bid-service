// @module 책임: PostToolUse 훅(Edit·Write·MultiEdit): 에이전트가 고친 apps/web 파일 하나를 web의 oxfmt로 맞춘다(대상 판정은 tools/agent-hooks/format-target.mjs).
// oxfmt는 그 checkout의 apps/web/node_modules, 없으면 메인 checkout의 것을 쓴다. 조용히 한다 — 무엇이 틀려도 한 줄만 알리고 0으로 끝난다.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { webFormatTarget } from '../../tools/agent-hooks/format-target.mjs';

function git(cwd, args) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

let file;
try {
  file = JSON.parse(readFileSync(0, 'utf8'))?.tool_input?.file_path;
} catch {
  process.exit(0);
}
if (typeof file !== 'string' || !existsSync(file)) process.exit(0);
file = path.resolve(file);

const root = git(path.dirname(file), ['rev-parse', '--show-toplevel']);
if (root === null) process.exit(0);
const target = webFormatTarget(file, path.resolve(root));
if (target === null) process.exit(0);

const commonDir = git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
const candidates = [path.join(target.cwd, 'node_modules', 'oxfmt', 'bin', 'oxfmt')];
if (commonDir !== null) candidates.push(path.join(path.dirname(commonDir), 'apps', 'web', 'node_modules', 'oxfmt', 'bin', 'oxfmt'));
const bin = candidates.find((candidate) => existsSync(candidate));
if (bin === undefined) {
  process.stderr.write(`format-on-edit: oxfmt를 찾지 못해 포맷하지 않았어요(먼저 pnpm install): ${file}\n`);
  process.exit(0);
}
const result = spawnSync(process.execPath, [bin, '--write', target.file], { cwd: target.cwd, stdio: 'ignore', timeout: 20_000 });
if (result.status !== 0) process.stderr.write(`format-on-edit: oxfmt가 실패했어요: ${file}\n`);
process.exit(0);
