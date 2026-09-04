/** @module 책임: 결정 화면 전체 조건(기간·모집단)을 URL search param으로 보존하는 nuqs parser를 한 곳에서 소유한다. page.tsx의 Suspense loader가 서버에서 `createLoader`로 이 parser를 실행하므로 client 전용 'nuqs'가 아니라 'nuqs/server'에서 가져온다. */
import { parseAsString, parseAsStringLiteral } from 'nuqs/server';

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
  item: parseAsString
};

export type DecisionSearch = {
  readonly period: (typeof DECISION_PERIODS)[number];
  readonly scope: (typeof DECISION_SCOPES)[number];
  readonly view: (typeof DECISION_VIEWS)[number];
  readonly item: string | null;
};

export type DecisionView = (typeof DECISION_VIEWS)[number];

/** 옮겨 가려는 탭은 query에 늘 실리므로 `?` 뒤가 빈 주소는 나오지 않는다. */
export type DecisionRoute = `/auctions/${string}?${string}`;

/**
 * 탭 링크. `UrlObject`는 typedRoutes 검사를 받지 않으므로 `analysis-route.ts`와 같은 typed template
 * literal로 만든다. 탭을 눌렀다고 기간·모집단·품목이 초기화되면 사용자가 만든 비교 조건이 조용히
 * 사라지므로 지금 조건을 그대로 들고 가되, 기본값은 parser가 되살리므로 주소에 남기지 않는다.
 */
export function buildDecisionViewRoute(auctionId: string, search: DecisionSearch, view: DecisionView): DecisionRoute {
  const query = new URLSearchParams();
  if (search.period !== decisionSearchParsers.period.defaultValue) query.set('period', search.period);
  if (search.scope !== decisionSearchParsers.scope.defaultValue) query.set('scope', search.scope);
  if (search.item !== null) query.set('item', search.item);
  query.set('view', view);
  const pathname: `/auctions/${string}` = `/auctions/${encodeURIComponent(auctionId)}`;
  return `${pathname}?${query.toString()}`;
}
