/** @module 책임: 결정 화면 전체 조건(기간·모집단·내 값·손잡이 투찰률·크게 보기)을 URL search param으로 보존하는 nuqs parser를 한 곳에서 소유한다. page.tsx의 Suspense loader가 서버에서 `createLoader`로 이 parser를 실행하므로 client 전용 'nuqs'가 아니라 'nuqs/server'에서 가져온다. */
import { parseAsInteger, parseAsString, parseAsStringLiteral } from 'nuqs/server';

export const DECISION_PERIODS = ['12개월', '3개월', '이번 달', '지난 달'] as const;
export const DECISION_SCOPES = ['전국', '도', '시군', '이 기관'] as const;
// 근거 영역의 탭. 호가창이 첫 탭이다. "내 값이 어디쯤인가"가 첫 질문이고 흐름은 그다음이다.
export const DECISION_VIEWS = ['비교집단', '흐름', '그날 하한', '업체'] as const;
/**
 * 크게 보기 모달의 본문 종류. 근거 탭 넷은 탭 이름 그대로이고 과거 회차 카드는 탭이 아니라서 따로 있다.
 * 값이 탭 이름과 같으므로 탭에서 여는 링크는 `search.view`를 그대로 실을 수 있다.
 */
export const DECISION_EXPANDS = ['과거 회차', ...DECISION_VIEWS] as const;

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
  // 크게 보기 모달도 주소다. 어느 본문이 열렸는지가 주소에 남아야 뒤로 가기가 모달을 닫고 링크로 그
  // 상태를 공유할 수 있다. 비교집단 모달은 같은 분포 endpoint를 granularity=month로 다시 부른다.
  // 기본값을 두지 않아 닫힌 상태는 주소에 남지 않는다.
  expand: parseAsStringLiteral(DECISION_EXPANDS),
  /**
   * 과거 회차 모달이 cursor를 따라 이어 붙인 페이지 수. 서버가 페이지를 부르므로(`presentHistory`의 Temporal을
   * client bundle에 넣지 않는다) "더 불러오기"는 이 값을 하나 올린 주소다. 상한·정수 검증은 loader가 한다.
   * nuqs는 이 property 이름을 URL key로 쓰므로 `decisionQuery`가 쓰는 `pages`와 같은 이름이어야 한다.
   */
  pages: parseAsInteger.withDefault(1)
};

export type DecisionSearch = {
  readonly period: (typeof DECISION_PERIODS)[number];
  readonly scope: (typeof DECISION_SCOPES)[number];
  readonly view: (typeof DECISION_VIEWS)[number];
  readonly item: string | null;
  readonly myRate: string | null;
  readonly rate: string | null;
  readonly expand: DecisionExpand | null;
  readonly pages: number;
};

export type DecisionView = (typeof DECISION_VIEWS)[number];
export type DecisionExpand = (typeof DECISION_EXPANDS)[number];

/** 옮겨 가려는 탭은 query에 늘 실리므로 `?` 뒤가 빈 주소는 나오지 않는다. */
export type DecisionRoute = `/auctions/${string}?${string}`;

function decisionQuery(search: DecisionSearch): URLSearchParams {
  const query = new URLSearchParams();
  if (search.period !== decisionSearchParsers.period.defaultValue) query.set('period', search.period);
  if (search.scope !== decisionSearchParsers.scope.defaultValue) query.set('scope', search.scope);
  if (search.item !== null) query.set('item', search.item);
  if (search.myRate !== null) query.set('myRate', search.myRate);
  if (search.rate !== null) query.set('rate', search.rate);
  if (search.expand !== null) query.set('expand', search.expand);
  // 페이지 수는 과거 회차 모달 안에서만 뜻이 있다. 다른 본문·닫힌 상태의 주소에 끌고 다니면 다시 열 때
  // 옛 페이지 수가 되살아난다.
  if (search.expand === '과거 회차' && search.pages > 1) query.set('pages', String(search.pages));
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

/** 과거 회차 모달의 다음 페이지 링크. 모달 본문은 그대로 두고 페이지 수만 바꾼다. */
export function buildDecisionHistoryPagesRoute(auctionId: string, search: DecisionSearch, pages: number): DecisionRoute {
  return buildDecisionViewRoute(auctionId, { ...search, expand: '과거 회차', pages }, search.view);
}

/** 크게 보기 열기(`expand`에 본문 이름)·닫기(null). 탭과 나머지 조건은 그대로 둔다. */
export function buildDecisionExpandRoute(
  auctionId: string,
  search: DecisionSearch,
  expand: DecisionExpand | null
): DecisionRoute {
  return buildDecisionViewRoute(auctionId, { ...search, expand }, search.view);
}
