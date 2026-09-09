/** @module 책임: 로그인 뒤 돌아갈 경로가 같은 앱의 상대 경로인지 판정하고 로그인·복귀 route를 만든다. */
import type { Route } from 'next';

/** 돌아갈 곳이 정해지지 않았거나 값이 안전하지 않을 때의 기본 진입 경로다. */
export const DEFAULT_RETURN_PATH = '/today';

/**
 * Next redirect가 받는 값은 존재하는 route여야 하므로 복귀 대상을 실제 화면 목록으로 좁힌다. provider에
 * 넘기는 `callbackURL`은 브라우저 탐색이라 검증된 상대 경로 전체를 그대로 쓴다. 두 경계의 요구가 달라서
 * 함수도 둘이다.
 */
const REDIRECT_TARGETS = ['/', '/today', '/setup'] as const;

/**
 * 공고 상세는 이 앱에서 가장 흔한 복귀 지점이라 목록에 적을 수 없는 동적 route를 하나 더 받는다.
 * 식별자는 선행 0 없는 양의 10진 문자열이므로(ADR 0018) 그 모양만 통과시키고, 통과한 값으로 route를
 * 다시 만들어 typedRoutes 검사를 그대로 받는다.
 */
const AUCTION_DETAIL_PATH = /^\/auctions\/([1-9]\d{0,19})$/;

/** 요청 URL과 로그인 화면 사이에 오가는 query parameter 이름이다. */
export const RETURN_PATH_PARAMETER = 'next';

export type LoginRoute = '/login' | `/login?${string}`;
export type SetupRoute = '/setup' | `/setup?${string}`;
/** typedRoutes의 `Route`는 동적 route를 literal 형태로만 인정하므로 공고 상세 template을 함께 적는다. */
export type ReturnRoute = Route | `/auctions/${string}`;

const MAX_RETURN_PATH_LENGTH = 512;
const SPACE_CODE_POINT = 0x20;
const DELETE_CODE_POINT = 0x7f;
const LINE_SEPARATOR_CODE_POINT = 0x2028;
const PARAGRAPH_SEPARATOR_CODE_POINT = 0x2029;
// 인코딩된 구분자와 이중 인코딩은 검사를 통과한 뒤 경로 의미가 한 번 더 바뀌는 경로다.
const ENCODED_SEPARATOR = /%(?:2f|5c|25|00)/i;
const VALIDATION_BASE = 'http://return.invalid';

/**
 * 제어문자·공백·역슬래시와 줄 구분자는 브라우저와 서버가 서로 다르게 읽는 지점이고, 그 차이가 열린
 * 리디렉션이 된다. 문자 하나씩 판정해 정규식 escape 실수로 검사가 느슨해지는 경로를 없앤다.
 */
function hasUnsafeCharacter(value: string): boolean {
  for (const character of value) {
    if (character === '\\') return true;
    const code = character.codePointAt(0) ?? 0;
    if (code <= SPACE_CODE_POINT || code === DELETE_CODE_POINT) return true;
    if (code === LINE_SEPARATOR_CODE_POINT || code === PARAGRAPH_SEPARATOR_CODE_POINT) return true;
  }
  return false;
}

/**
 * 같은 앱의 절대 경로만 통과시킨다. `//`와 `/\`는 브라우저가 authority로 읽어 다른 origin으로 보내므로
 * 앞의 `/` 하나만 보고 판정하면 열린 리디렉션이 열린다(ADR 0032 §6). 이 parameter에는 사용자 데이터나
 * 비밀 값을 담지 않는다.
 */
export function isSameAppReturnPath(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value.length === 0 || value.length > MAX_RETURN_PATH_LENGTH) return false;
  if (!value.startsWith('/')) return false;
  if (value.startsWith('//') || value.startsWith('/\\')) return false;
  if (hasUnsafeCharacter(value) || ENCODED_SEPARATOR.test(value)) return false;
  try {
    return new URL(value, VALIDATION_BASE).origin === VALIDATION_BASE;
  } catch {
    return false;
  }
}

/** 안전하지 않은 값은 오류가 아니라 기본 경로로 대체한다. 진입 화면이 오류를 렌더할 이유가 없다. */
export function safeReturnPath(value: unknown, fallback: string = DEFAULT_RETURN_PATH): string {
  return isSameAppReturnPath(value) ? value : fallback;
}

/**
 * 이미 로그인한 방문자를 되돌려 보낼 route다. 목록에 없는 경로는 기본 진입으로 대체한다. query는 살려
 * 두어 필터가 걸린 화면으로 돌아온 사용자가 조건을 다시 고르지 않게 한다.
 */
export function returnRoute(value: unknown): ReturnRoute {
  const { pathname, search } = splitReturnPath(safeReturnPath(value));
  const target = knownScreen(pathname);
  if (target === undefined) return DEFAULT_RETURN_PATH;
  return search === '' ? target : `${target}?${search}`;
}

/**
 * 화면 판정은 pathname만 본다. query는 보존하고 fragment는 싣지 않는다. 복귀 대상은 typed route라
 * fragment를 모양으로 모델링하지 않는데, 그 한 조각 때문에 판정이 어긋나 보던 화면을 통째로 잃는 쪽이
 * 앵커 하나를 잃는 것보다 훨씬 나쁘다.
 */
function splitReturnPath(path: string): { readonly pathname: string; readonly search: string } {
  const fragment = path.indexOf('#');
  const addressed = fragment === -1 ? path : path.slice(0, fragment);
  const separator = addressed.indexOf('?');
  if (separator === -1) return { pathname: addressed, search: '' };
  return { pathname: addressed.slice(0, separator), search: addressed.slice(separator + 1) };
}

type KnownScreen = (typeof REDIRECT_TARGETS)[number] | `/auctions/${string}`;

function knownScreen(pathname: string): KnownScreen | undefined {
  const listed = REDIRECT_TARGETS.find((route) => route === pathname);
  if (listed !== undefined) return listed;
  const auction = AUCTION_DETAIL_PATH.exec(pathname);
  return auction === null ? undefined : `/auctions/${auction[1]}`;
}

/** 복귀 대상이 공고 상세인지 말한다. 화면은 이 사실로 링크 문구만 고른다. */
export function isAuctionReturn(value: unknown): boolean {
  return AUCTION_DETAIL_PATH.test(splitReturnPath(safeReturnPath(value, '')).pathname);
}

/**
 * 로그인 화면 링크다. `UrlObject`는 typedRoutes 검사를 받지 않으므로 typed template literal로 만든다.
 * 담는 값은 받는 쪽에서 같은 함수로 한 번 더 판정한다.
 */
export function loginRouteWithReturn(returnPath: unknown): LoginRoute {
  return `/login?${returnQuery(returnPath)}`;
}

/**
 * 설정 화면 링크다. 로그인만 끝난 사용자를 여기로 보낼 때 원래 보던 화면을 잃지 않게 같은 parameter를
 * 그대로 이어 나른다. 사업자등록번호처럼 사용자 자료를 URL에 담지 않는다.
 */
export function setupRouteWithReturn(returnPath: unknown): SetupRoute {
  if (!isSameAppReturnPath(returnPath)) return '/setup';
  return `/setup?${returnQuery(returnPath)}`;
}

function returnQuery(returnPath: unknown): string {
  return new URLSearchParams({ [RETURN_PATH_PARAMETER]: safeReturnPath(returnPath) }).toString();
}
