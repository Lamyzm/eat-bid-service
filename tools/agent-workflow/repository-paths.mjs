/** @module 책임: 편집 대상 경로가 저장소의 어떤 루트에도 속하지 않는지 심볼릭 링크·경로 표기 우회까지 해석해 판정한다. */
import { realpathSync } from "node:fs";
import path from "node:path";

// 제어문자가 섞인 경로는 사람이 의도한 파일 이름이 아니다. 정규화를 시도하지 않고 거부한다.
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;

// Windows의 `\\?\`·`\\.\`는 같은 파일을 다른 문자열로 가리키는 표기다. 벗겨내지 않으면
// `path.relative`가 드라이브 경로와 비교하지 못해 저장소 안 파일이 "밖"으로 읽힌다.
const WINDOWS_DEVICE_PREFIX = /^\\\\[?.]\\/;

// UNC(`\\server\share`, `\\?\UNC\...`)는 로컬 저장소 루트와 같은 실체를 가리켜도 문자열로는 이어지지
// 않는다. 같은지 다른지 말할 수 없으므로 판정하지 않고 저장소 안으로 취급해 fail-closed한다.
const UNC_PATH = /^\\\\/;

/**
 * 존재하지 않는 파일도 판정할 수 있어야 한다. 새 파일을 만드는 편집이 대부분이기 때문이다. 그래서
 * 존재하는 가장 가까운 조상까지 실제 경로를 구한 뒤 남은 이름을 다시 붙인다. 조상이 하나도 없거나
 * 해석이 실패하면 `null`을 돌려주고, 호출자는 그것을 "밖"이 아니라 "모름"으로 다룬다.
 */
export function resolveRealPath(candidate, realPath = realpathSync.native) {
  let current = path.resolve(candidate);
  const trailing = [];
  for (;;) {
    try {
      const resolved = realPath(current);
      return trailing.length > 0 ? path.join(resolved, ...trailing.slice().reverse()) : resolved;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return null;
      trailing.push(path.basename(current));
      current = parent;
    }
  }
}

// Windows 파일 시스템은 대소문자를 구분하지 않으므로 `F:\`와 `f:\`는 같은 경로다. 문자열로만 비교하면
// 드라이브 문자 하나로 저장소 안 파일을 밖으로 만들 수 있다.
function comparablePath(value, platform) {
  const normalized = path.resolve(value).replaceAll("\\", "/").replace(/\/+$/, "");
  return platform === "win32" ? normalized.toLowerCase() : normalized;
}

function isWithin(candidate, root) {
  return candidate === root || candidate.startsWith(`${root}/`);
}

/**
 * 저장소 "밖"의 기준은 현재 worktree 하나가 아니라 저장소 전체다. main checkout, 형제 worktree,
 * `.git` common dir, lease state 파일까지 모두 안이어야 lease gate가 지키려는 대상이 남는다.
 * 루트를 모르거나 경로를 해석하지 못하면 밖이라고 말하지 않는다. 판정 불가는 곧 lease 요구다.
 */
export function isOutsideRepositoryRoots(
  candidate,
  roots,
  { platform = process.platform, realPath = realpathSync.native } = {},
) {
  if (typeof candidate !== "string" || candidate.length === 0) return false;
  if (CONTROL_CHARACTER.test(candidate)) return false;
  if (!Array.isArray(roots) || roots.length === 0) return false;

  if (UNC_PATH.test(candidate) && !WINDOWS_DEVICE_PREFIX.test(candidate)) return false;
  const stripped = candidate.replace(WINDOWS_DEVICE_PREFIX, "");
  if (/^UNC[\\/]/iu.test(stripped)) return false;
  if (!path.isAbsolute(stripped)) return false;

  const resolved = resolveRealPath(stripped, realPath);
  if (!resolved) return false;
  const comparable = comparablePath(resolved, platform);

  for (const root of roots) {
    if (typeof root !== "string" || root.length === 0) return false;
    const resolvedRoot = resolveRealPath(root, realPath);
    if (!resolvedRoot) return false;
    if (isWithin(comparable, comparablePath(resolvedRoot, platform))) return false;
  }
  return true;
}
