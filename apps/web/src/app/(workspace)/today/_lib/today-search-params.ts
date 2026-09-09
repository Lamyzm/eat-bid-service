/** @module 책임: 오늘 화면 필터(지역·품목·기간·기초금액·cursor)를 URL search param으로 보존하는 nuqs parser와 필터 링크 빌더를 한 곳에서 소유한다. page.tsx의 Suspense loader가 서버에서 `createLoader`로 이 parser를 실행하므로 client 전용 'nuqs'가 아니라 'nuqs/server'에서 가져온다. */
import { createSerializer, parseAsInteger, parseAsString, type inferParserType } from 'nuqs/server';

// 형식 검증(양의 정수 id, 소수 둘째 자리 금액, 1..720시간)은 여기서 하지 않는다. `_model/load-today-page.ts`의
// loader가 계약 schema로 조회 직전에 걸러 무효 값을 null로 다루고, 네트워크 호출 전에 무효 요청을 없앤다.
export const todaySearchParsers = {
  region: parseAsString,
  item: parseAsString,
  closesWithinHours: parseAsInteger,
  baseAmountMin: parseAsString,
  baseAmountMax: parseAsString,
  cursor: parseAsString
};

/** 조건의 이름과 타입은 위 parser 선언이 소유한다. 여기서 같은 목록을 다시 적으면 둘이 조용히 어긋난다. */
export type TodaySearch = Readonly<inferParserType<typeof todaySearchParsers>>;

export const EMPTY_TODAY_SEARCH: TodaySearch = {
  region: null,
  item: null,
  closesWithinHours: null,
  baseAmountMin: null,
  baseAmountMax: null,
  cursor: null
};

// 기간 프리셋은 등록된 값만 쓴다. 자유 입력 시간은 만들지 않는다. 24·72·168은 계약 상한 720 안이다.
export const PERIOD_PRESETS = [
  { label: '오늘 안', hours: 24 },
  { label: '3일', hours: 72 },
  { label: '일주일', hours: 168 }
] as const;

// 기초금액 프리셋도 등록된 경계만 쓴다. 경계 문자열은 계약의 소수 둘째 자리 고정 형식 그대로다.
export const BASE_AMOUNT_PRESETS = [
  { label: '300만 이하', min: null, max: '3000000.00' },
  { label: '300만~1,000만', min: '3000000.00', max: '10000000.00' },
  { label: '1,000만~3,000만', min: '10000000.00', max: '30000000.00' },
  { label: '3,000만 이상', min: '30000000.00', max: null }
] as const;

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
