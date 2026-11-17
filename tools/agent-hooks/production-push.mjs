/**
 * @module 책임: 에이전트 셸 명령이 배포 경로(main·deploy/prod 가지, release 태그)를 손으로 움직이는지 판정한다.
 *
 * main은 PR로만 들어가고(ADR 0050), deploy/prod는 릴리스 빌드의 승격 잡만 쓰며, release 태그는 `pnpm workflow:tag`가
 * 빌드 진행·main 검증을 확인한 뒤 만든다. 손으로 움직이면 이 확인을 건너뛰어 운영이 검증 안 된 커밋으로 간다.
 * 판정은 명령 글만 본다 — `pnpm workflow:pr`·`workflow:tag`처럼 안에서 push하는 정해진 길은 글에 `git push`가 없어 지나간다.
 */

const PROTECTED_BRANCHES = ['main', 'deploy/prod'];

/** 셸 글을 명령 단위로 자른다. 따옴표 안의 구분자는 정밀하게 다루지 않는다 — 막는 쪽으로 틀리는 편이 낫다. */
function segments(command) {
  return command.split(/&&|\|\||;|\n|\|/).map((part) => part.trim()).filter(Boolean);
}

function words(segment) {
  return segment.match(/"[^"]*"|'[^']*'|\S+/g)?.map((word) => word.replace(/^["']|["']$/g, '')) ?? [];
}

/** `git [-C dir] [-c k=v] push …`의 push 뒤 인자를 돌려준다. push가 아니면 null이다. */
function pushArgs(segment) {
  const list = words(segment);
  const git = list.findIndex((word) => word === 'git' || word.endsWith('/git') || word.endsWith('\\git.exe') || word === 'git.exe');
  if (git < 0) return null;
  for (let index = git + 1; index < list.length; index += 1) {
    const word = list[index];
    if (word === '-C' || word === '-c') {
      index += 1;
      continue;
    }
    if (word.startsWith('-')) continue;
    return word === 'push' ? list.slice(index + 1) : null;
  }
  return null;
}

function refDestination(spec) {
  const target = spec.includes(':') ? spec.slice(spec.lastIndexOf(':') + 1) : spec;
  return target.replace(/^\+/, '').replace(/^refs\/heads\//, '');
}

/**
 * 막을 까닭을 돌려준다. 지나가면 null이다.
 * @param {string} command 셸 명령 글
 * @param {string | null} currentBranch 지금 가지(모르면 null) — 인자 없는 `git push`가 어디로 가는지 판정한다
 */
export function productionPushReason(command, currentBranch) {
  for (const segment of segments(command)) {
    if (/\bgh\s+api\b/.test(segment) && /git\/refs/.test(segment) && /refs\/tags\/release\//.test(segment)) {
      return 'release 태그를 gh api로 직접 만들려 했어요';
    }
    const args = pushArgs(segment);
    if (args === null) continue;
    const positional = args.filter((arg) => !arg.startsWith('-'));
    if (args.includes('--tags') || args.includes('--follow-tags')) return '태그를 한꺼번에 push하려 했어요';
    if (positional.some((spec) => /(^|\/|:)release\//.test(spec) && !spec.startsWith('refs/heads/'))) return 'release 태그를 손으로 push하려 했어요';
    if (args.includes('--mirror') || args.includes('--all')) return '모든 가지를 한꺼번에 push하려 했어요';
    const specs = positional.slice(1);
    for (const spec of specs) {
      const destination = refDestination(spec);
      if (PROTECTED_BRANCHES.includes(destination)) return `${destination} 가지로 직접 push하려 했어요`;
      if (spec === 'HEAD' && currentBranch !== null && PROTECTED_BRANCHES.includes(currentBranch)) return `${currentBranch} 가지로 직접 push하려 했어요`;
    }
    if (specs.length === 0 && currentBranch !== null && PROTECTED_BRANCHES.includes(currentBranch)) {
      return `${currentBranch} 가지에서 그대로 push하려 했어요`;
    }
  }
  return null;
}
