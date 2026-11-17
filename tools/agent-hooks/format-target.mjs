/**
 * @module 책임: 에이전트가 고친 파일이 이 저장소의 어떤 포맷 도구 대상인지 판정한다.
 *
 * 저장소에서 포맷 도구를 쓰는 곳은 `apps/web`의 oxfmt 하나다(커밋 전 lint-staged와 같은 대상). 그 밖의 파일은 손대지 않는다 —
 * 서버·문서에 포맷을 새로 들이는 일은 이 hook이 아니라 따로 정한다. 마크다운·YAML은 web의 `format` 스크립트도 뺀다.
 */
import path from 'node:path';

const WEB_FORMATTED = /\.(?:[cm]?[jt]sx?|json|css)$/i;

/**
 * oxfmt를 돌릴 자리를 돌려준다. 대상이 아니면 null이다.
 * @param {string} file 절대 경로
 * @param {string} checkoutRoot 그 파일이 든 checkout의 뿌리(절대 경로)
 */
export function webFormatTarget(file, checkoutRoot) {
  const relative = path.relative(checkoutRoot, file).split(path.sep).join('/');
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  if (!relative.startsWith('apps/web/') || relative.includes('/node_modules/') || relative.includes('/.next/')) return null;
  if (!WEB_FORMATTED.test(relative)) return null;
  return { cwd: path.join(checkoutRoot, 'apps', 'web'), file: relative.slice('apps/web/'.length) };
}
