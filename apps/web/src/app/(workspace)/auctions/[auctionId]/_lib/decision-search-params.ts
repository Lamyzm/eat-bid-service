/** @module 책임: 결정 화면 전체 조건(기간·모집단·내 값·손잡이 투찰률·크게 보기)을 URL search param으로 보존하는 nuqs parser를 한 곳에서 소유한다. page.tsx의 Suspense loader가 서버에서 `createLoader`로 이 parser를 실행하므로 client 전용 'nuqs'가 아니라 'nuqs/server'에서 가져온다. */
import { parseAsBoolean, parseAsString, parseAsStringLiteral } from 'nuqs/server';

export const DECISION_PERIODS = ['12개월', '3개월', '이번 달', '지난 달'] as const;
export const DECISION_SCOPES = ['전국', '도', '시군', '이 기관'] as const;
// 근거 영역의 탭. 호가창이 첫 탭이다. "내 값이 어디쯤인가"가 첫 질문이고 흐름은 그다음이다.
export const DECISION_VIEWS = ['비교집단', '흐름', '그날 하한', '업체'] as const;

export const decisionSearchParsers = {
  period: parseAsStringLiteral(DECISION_PERIODS).withDefault('12개월'),
  scope: parseAsStringLiteral(DECISION_SCOPES).withDefault('전국'),
  // 탭은 화면 상태가 아니라 주소다. 링크로 특정 근거를 그대로 공유할 수 있어야 하고 (workspace)에는
  // nuqs adapter가 없어 client hook을 쓸 수 없다.
  view: parseAsStringLiteral(DECISION_VIEWS).withDefault('비교집단'),
  // 형식 검증(양의 정수 codeValueId)은 여기서 하지 않는다. `load-auction-page.ts`의 loader가
  // 회차 이력 조회 직전에 검증해 무효 값을 null로 다룬다.
  item: parseAsString,
  /**
   * 호가창에 얹는 "내 값"이다. **사정률**(분모 예정가격)이며 레일 손잡이의 투찰률(분모 기초금액)과
   * 다른 축이다(PDR-0004). **기본값을 두지 않는다** — 최빈 칸이나 하한율을 기본값으로 두면 그것이
   * 추천값이 된다(AGENTS 8). 형식 검증은 `_model/present-distribution.ts`가 한다.
   */
  myRate: parseAsString,
  /**
   * 투찰 레일 손잡이의 **투찰률**(분모 기초금액). 사용자가 놓은 값만 실리고 **기본값을 두지 않는다** —
   * 화면이 먼저 놓아 준 손잡이 값은 표 마지막 열·"이 값이면"까지 번지는 추천값이 된다(AGENTS 8,
   * PDR-0004, EAT-84). 형식 검증은 `_ui/bid-rate-context.tsx`가 `parseBidRate`로 하며 틀린 값은 빈 상태다.
   */
  rate: parseAsString,
  // 크게 보기(12개월 × 칸 히트맵)도 주소다. 같은 endpoint를 granularity=month로 다시 부른다.
  expand: parseAsBoolean.withDefault(false)
};

export type DecisionSearch = {
  readonly period: (typeof DECISION_PERIODS)[number];
  readonly scope: (typeof DECISION_SCOPES)[number];
  readonly view: (typeof DECISION_VIEWS)[number];
  readonly item: string | null;
  readonly myRate: string | null;
  readonly rate: string | null;
  readonly expand: boolean;
};

export type DecisionView = (typeof DECISION_VIEWS)[number];

/** 옮겨 가려는 탭은 query에 늘 실리므로 `?` 뒤가 빈 주소는 나오지 않는다. */
export type DecisionRoute = `/auctions/${string}?${string}`;

function decisionQuery(search: DecisionSearch): URLSearchParams {
  const query = new URLSearchParams();
  if (search.period !== decisionSearchParsers.period.defaultValue) query.set('period', search.period);
  if (search.scope !== decisionSearchParsers.scope.defaultValue) query.set('scope', search.scope);
  if (search.item !== null) query.set('item', search.item);
  if (search.myRate !== null) query.set('myRate', search.myRate);
  if (search.rate !== null) query.set('rate', search.rate);
  if (search.expand) query.set('expand', 'true');
  return query;
}

/**
 * 탭 링크. `UrlObject`는 typedRoutes 검사를 받지 않으므로 `analysis-route.ts`와 같은 typed template
 * literal로 만든다. 탭을 눌렀다고 기간·모집단·품목·내 값이 초기화되면 사용자가 만든 비교 조건이 조용히
 * 사라지므로 지금 조건을 그대로 들고 가되, 기본값은 parser가 되살리므로 주소에 남기지 않는다.
 */
export function buildDecisionViewRoute(auctionId: string, search: DecisionSearch, view: DecisionView): DecisionRoute {
  const query = decisionQuery(search);
  query.set('view', view);
  const pathname: `/auctions/${string}` = `/auctions/${encodeURIComponent(auctionId)}`;
  return `${pathname}?${query.toString()}`;
}

/** 크게 보기 토글. 탭과 나머지 조건은 그대로 두고 `expand`만 뒤집는다. */
export function buildDecisionExpandRoute(auctionId: string, search: DecisionSearch, expand: boolean): DecisionRoute {
  return buildDecisionViewRoute(auctionId, { ...search, expand }, search.view);
}
