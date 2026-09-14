/** @module 책임: 오늘 화면 필터(지역·품목·기간·기초금액·cursor)를 URL search param으로 보존하는 nuqs parser와 필터 링크 빌더를 한 곳에서 소유한다. page.tsx의 Suspense loader가 서버에서 `createLoader`로 이 parser를 실행하므로 client 전용 'nuqs'가 아니라 'nuqs/server'에서 가져온다. */
import { createSerializer, parseAsArrayOf, parseAsInteger, parseAsString, type inferParserType } from 'nuqs/server';

// 형식 검증(양의 정수 id, 소수 둘째 자리 금액, 1..720시간)은 여기서 하지 않는다. `_model/load-today-page.ts`의
// loader가 계약 schema로 조회 직전에 걸러 무효 값을 null로 다루고, 네트워크 호출 전에 무효 요청을 없앤다.
export const todaySearchParsers = {
  /**
   * `all`이면 워크스페이스가 확인한 관심 지역을 이번 조회에만 걸지 않는다. 저장된 설정은 그대로 두고
   * 보는 범위만 넓히는 출구라서 저장 command가 아니라 주소 하나로 표현한다.
   */
  scope: parseAsString,
  sido: parseAsString,
  /**
   * 품목 조각들이다. 한 조각이라도 라벨 안에 들어 있으면 걸린다(부분일치 OR).
   *
   * 원천 라벨이 `육류 , 가금류`처럼 합성 문자열이라 완전일치로는 절반을 놓친다. 조각을 쉼표로 이어
   * 주소에 싣는데, 조각 자체는 그 쉼표로 나눈 것이라 다시 쉼표를 품을 수 없다.
   */
  items: parseAsArrayOf(parseAsString, ','),
  closesWithinHours: parseAsInteger,
  /**
   * KST 달력일 축 둘이다. 탭과 달력 칸이 이 둘로 표현된다 — 시간 창(`closesWithinHours`)과 다른 것을 세며
   * 계약이 둘을 함께 받지 않는다(controller가 400으로 막는다). 그래서 탭 링크는 시간 창을 함께 지운다.
   */
  closesOn: parseAsString,
  announcedOn: parseAsString,
  baseAmountMin: parseAsString,
  baseAmountMax: parseAsString,
  cursor: parseAsString
};

/** 조건의 이름과 타입은 위 parser 선언이 소유한다. 여기서 같은 목록을 다시 적으면 둘이 조용히 어긋난다. */
export type TodaySearch = Readonly<inferParserType<typeof todaySearchParsers>>;

export const EMPTY_TODAY_SEARCH: TodaySearch = {
  scope: null,
  sido: null,
  items: null,
  closesWithinHours: null,
  closesOn: null,
  announcedOn: null,
  baseAmountMin: null,
  baseAmountMax: null,
  cursor: null
};

/**
 * 기초금액은 최소·최대 두 칸이고 구간 프리셋 버튼을 만들지 않는다.
 *
 * `300만`·`1,000만` 같은 경계는 우리가 고르는 값이고, 버튼으로 두면 그 정의를 우리가 소유하게 된다.
 * 양끝이 다 필요한 근거는 실측이다 — 2026-09-13 전국 열린 공고 중 3,000만 이상이 328건(28%)인데
 * 사용자가 실제로 낸 849건의 최대가 3,292만이라 그 위는 볼 일이 없다.
 *
 * 사람은 `3000000`처럼 적고 계약은 소수 둘째 자리를 고정한다. 자릿수만 다른 값을 무효로 버리면 입력이
 * 조용히 사라지므로 여기서 한 번 맞춰 준다. 숫자가 아닌 입력은 그대로 계약이 거른다.
 */
export function normalizeAmountInput(value: string | null): string | null {
  if (value === null) return null;
  const digits = value.replaceAll(',', '').trim();
  return /^\d+$/.test(digits) ? `${digits}.00` : value;
}

/** 저장된 관심 지역을 이번 조회에서만 풀어 두는 값이다. 다른 문자열은 설정을 적용한 것과 같다. */
export const ALL_REGIONS_SCOPE = 'all';

export type TodayRoute = '/today' | `/today?${string}`;

/**
 * 링크를 만드는 쪽도 주소를 읽는 쪽과 같은 parser를 쓴다. 조건 이름과 인코딩 규칙을 여기서 다시 적으면
 * 이름 하나를 바꿀 때 읽기와 쓰기가 조용히 어긋난다(같은 이유로 `TodaySearch`도 parser에서 파생한다).
 */
const serializeTodaySearch = createSerializer(todaySearchParsers);

/**
 * 필터 링크. `UrlObject`는 typedRoutes 검사를 받지 않으므로 typed template literal로 만든다. 값이 없는
 * 조건은 serializer가 주소에서 뺀다. 필터가 바뀌면 cursor는 의미를 잃으므로 호출자가 cursor를 null로 넘긴다 —
 * 여기서 조용히 지우면 "다음 페이지" 링크도 cursor를 잃는다.
 */
export function buildTodayRoute(search: TodaySearch): TodayRoute {
  // serializer는 `?`까지 붙인 검색 문자열을 준다. `/today?${string}` 형태를 유지하려고 앞의 `?`만 떼어 낸다.
  const query = serializeTodaySearch(search).replace(/^\?/, '');
  return query === '' ? '/today' : `/today?${query}`;
}

/** 조건 하나를 바꾸는 링크는 다른 조건을 지우지 않되 cursor만 되돌린다. */
export function buildTodayFilterRoute(search: TodaySearch, patch: Partial<TodaySearch>): TodayRoute {
  return buildTodayRoute({ ...search, ...patch, cursor: null });
}
