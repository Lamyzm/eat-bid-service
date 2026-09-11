/** @module 책임: 열린 공고 목록 계약 응답을 오늘 화면 표가 그대로 쓰는 표시값(KST 마감·D-day·금액·미확인 문구·(기관, 하한율) 요약)으로 바꾼다. */
import { Temporal } from '@eatbid/domain';
import type { OpenAuction, OpenAuctionListV1Response } from '@eatbid/contracts/api/v1/auctions';

const KST = 'Asia/Seoul';
const pad2 = (value: number): string => value.toString().padStart(2, '0');

export type ClosesTone = 'today' | 'tomorrow' | 'later' | 'unknown';

export type OpenAuctionRowPresentation = {
  readonly auctionAttemptId: string;
  readonly href: `/auctions/${string}`;
  readonly organization: {
    readonly text: string;
    // named는 관측 라벨, unnamed는 기관은 있으나 라벨 미관측, missing은 목록의 기관 코드가 core에 없음.
    readonly tone: 'named' | 'unnamed' | 'missing';
    readonly organizationId: string | null;
    readonly type: string | null;
  };
  readonly itemLabel: string | null;
  readonly floorRateText: string;
  readonly region: {
    readonly sido: { readonly codeValueId: string; readonly text: string } | null;
    readonly sigungu: { readonly codeValueId: string; readonly text: string } | null;
  };
  /**
   * 참가제한지역 표시값이다. `null`은 관측하지 못했다는 뜻이라 "제한 없음"으로 바꿔 적지 않는다.
   * 화면은 이 값이 null인 행을 `제한지역 미관측`으로 부른다(AGENTS 3).
   */
  readonly eligibilityText: string | null;
  readonly baseAmountText: string;
  readonly closes: {
    readonly tone: ClosesTone;
    // `D-0`·`D-1`처럼 색과 함께 읽히는 텍스트다. 색만으로 상태를 말하지 않는다(screen-system §11).
    readonly label: string;
    readonly timeText: string;
    readonly dDay: number | null;
  };
  readonly bidCountText: string;
  readonly orgSummary: {
    readonly attemptCount: number;
    readonly medianListText: string;
    readonly listCountSampleCount: number;
    readonly lastAwardedText: string;
    readonly lastOpenedText: string;
    readonly lastListText: string;
  } | null;
};

/**
 * 목록이 무엇을 보여야 하는지는 표시 모델이 정한다. 화면이 build 유무와 행 개수로 상태를 다시 계산하면
 * 같은 판정이 두 곳에 살고, 세 상태 중 하나를 더할 때 화면이 조용히 빠뜨린다.
 *
 * 활성 build가 없는 것은 파생물이 아직 없다는 뜻이고(ADR 0011·0034), 0건은 조건에 맞는 공고가 없다는
 * 뜻이다. 사용자가 할 일이 다르므로 합치지 않는다.
 */
export type OpenAuctionListView =
  | { readonly kind: 'no-snapshot' }
  | { readonly kind: 'empty' }
  | { readonly kind: 'list'; readonly rows: readonly OpenAuctionRowPresentation[] };

export type OpenAuctionListPresentation = {
  readonly view: OpenAuctionListView;
  readonly sampleCount: number;
  /** 참가제한지역 필터를 걸었을 때만 값이 있다. 필터가 없으면 묻지 않은 것이라 null이다. */
  readonly eligibilityMatchedCount: number | null;
  readonly eligibilityUnobservedCount: number | null;
  readonly asOfText: string;
  readonly lineageText: string;
  readonly nextCursor: string | null;
};

/** wire instant를 KST `MM-DD HH:mm`으로. `Temporal.ZonedDateTimeISO` 필드를 직접 읽으므로 ambient `Date`나
 * 로케일 구현체별 Intl 자정 표기 차이에 기대지 않는다(`present-decision.ts`의 `kst()`와 같은 방식). */
function kstDateTime(instant: string): string {
  const zoned = Temporal.Instant.from(instant).toZonedDateTimeISO(KST);
  return `${pad2(zoned.month)}-${pad2(zoned.day)} ${pad2(zoned.hour)}:${pad2(zoned.minute)}`;
}

function kstTime(instant: string): string {
  const zoned = Temporal.Instant.from(instant).toZonedDateTimeISO(KST);
  return `${pad2(zoned.hour)}:${pad2(zoned.minute)}`;
}

// D-day는 관측이 아니라 보는 시점에 대한 표현이라 계약이 아니라 화면이 계산한다. KST 달력일 차이다.
export function dDayOf(closesAt: string, nowIso: string): number {
  const closes = Temporal.Instant.from(closesAt).toZonedDateTimeISO(KST).toPlainDate();
  const today = Temporal.Instant.from(nowIso).toZonedDateTimeISO(KST).toPlainDate();
  return today.until(closes, { largestUnit: 'days' }).days;
}

function presentCloses(closesAt: string | null, nowIso: string): OpenAuctionRowPresentation['closes'] {
  if (closesAt === null) return { tone: 'unknown', label: '마감 미확인', timeText: '', dDay: null };
  const dDay = dDayOf(closesAt, nowIso);
  // 오늘·내일 마감은 시각까지 보인다. 그 뒤는 날짜가 더 중요하다.
  if (dDay <= 0) return { tone: 'today', label: 'D-0', timeText: kstTime(closesAt), dDay };
  if (dDay === 1) return { tone: 'tomorrow', label: 'D-1', timeText: kstTime(closesAt), dDay };
  return { tone: 'later', label: `D-${dDay}`, timeText: kstDateTime(closesAt), dDay };
}

function formatWon(amount: string): string {
  return amount.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// wire 소수부가 0이면 볼 이유가 없는 정밀도라 생략하고, 0이 아니면 관측된 값 그대로 보인다(반올림하지 않는다).
function formatAmountText(amount: string): string {
  const [whole, fraction = ''] = amount.split('.');
  const paddedFraction = (fraction + '00').slice(0, 2);
  return paddedFraction === '00' ? formatWon(whole) : `${formatWon(whole)}.${paddedFraction}`;
}

function presentOrganization(organization: OpenAuction['organization']): OpenAuctionRowPresentation['organization'] {
  if (organization === null) return { text: '기관 미확인', tone: 'missing', organizationId: null, type: null };
  if (organization.label === null) {
    return { text: '이름 미확인', tone: 'unnamed', organizationId: organization.organizationId, type: organization.type };
  }
  return { text: organization.label, tone: 'named', organizationId: organization.organizationId, type: organization.type };
}

// 라벨이 관측되지 않은 코드는 코드 문자열로 부른다. 지어낸 이름을 정부가 준 이름처럼 보이지 않게 한다.
function regionReference(value: NonNullable<OpenAuction['region']>['sido']): { readonly codeValueId: string; readonly text: string } | null {
  return value === null ? null : { codeValueId: value.codeValueId, text: value.label ?? `코드 ${value.code}` };
}

function presentRegion(region: OpenAuction['region']): OpenAuctionRowPresentation['region'] {
  return { sido: regionReference(region?.sido ?? null), sigungu: regionReference(region?.sigungu ?? null) };
}

/**
 * 제한지역이 여럿인 공고가 흔하다(실측 중앙값 11개, 최대 42개). 전부 나열하면 한 행이 표를 밀어내므로
 * 첫 이름과 나머지 수로 접는다. 라벨이 관측되지 않은 코드는 지어낸 이름 대신 코드 문자열로 부른다.
 */
function presentEligibility(areas: OpenAuction['eligibilityAreas']): string | null {
  if (areas === null || areas.length === 0) return null;
  const first = areas[0]!;
  const head = first.label ?? `코드 ${first.code}`;
  return areas.length === 1 ? head : `${head} 외 ${areas.length - 1}`;
}

/**
 * 요약은 이 행의 하한율 코호트에서만 온다. 그래서 값을 못 낸 이유가 셋이고 사용자가 할 일이 서로 다르다.
 * 같은 하한에서 본 회차가 아예 없는 것, 회차는 있는데 아직 개찰 전인 것, 개찰은 됐는데 낙찰을 관측하지
 * 못한 것을 한 문구로 합치면 화면이 없는 사실을 말한다(AGENTS 3).
 */
function lastAwardedTextOf(summary: NonNullable<OpenAuction['orgSummary']>): string {
  if (summary.attemptCount === 0) return '같은 하한 회차 없음';
  if (summary.lastRound === null) return '개찰 회차 없음';
  // 최근 낙찰은 투찰률 축(기초금액 분모)이다.
  return summary.lastRound.awardedBidRate?.value ?? '낙찰 미관측';
}

function presentOrgSummary(summary: OpenAuction['orgSummary']): OpenAuctionRowPresentation['orgSummary'] {
  if (summary === null) return null;
  const last = summary.lastRound;
  return {
    attemptCount: summary.attemptCount,
    medianListText: summary.medianListCount === null ? '—' : String(summary.medianListCount),
    listCountSampleCount: summary.listCountSampleCount,
    lastAwardedText: lastAwardedTextOf(summary),
    lastOpenedText: last === null ? '' : kstDateTime(last.openedAt),
    lastListText: last === null || last.listCount === null
      ? ''
      : last.belowDayFloorCount === null
        ? `명단 ${last.listCount}`
        : `명단 ${last.listCount} · 하한 아래 ${last.belowDayFloorCount}`
  };
}

export function presentOpenAuction(auction: OpenAuction, nowIso: string): OpenAuctionRowPresentation {
  return {
    auctionAttemptId: auction.auctionAttemptId,
    href: `/auctions/${encodeURIComponent(auction.auctionAttemptId)}`,
    organization: presentOrganization(auction.organization),
    itemLabel: auction.itemLabel,
    // 관측되지 않은 하한율을 0이나 90으로 채우면 화면이 없는 사실을 말한다(AGENTS 3).
    floorRateText: auction.floorRate?.value ?? '미확인',
    region: presentRegion(auction.region),
    eligibilityText: presentEligibility(auction.eligibilityAreas),
    baseAmountText: auction.baseAmount === null ? '미확인' : formatAmountText(auction.baseAmount.amount),
    closes: presentCloses(auction.closesAt, nowIso),
    bidCountText: auction.bidCount === null ? '—' : String(auction.bidCount),
    orgSummary: presentOrgSummary(auction.orgSummary)
  };
}

function lineageText(response: OpenAuctionListV1Response): string {
  const snapshot = response.meta.openAuctionSnapshotBuild;
  const summary = response.meta.orgRoundSummaryBuild;
  const parts = [
    snapshot.buildId === null
      ? '열린 공고 스냅샷 없음'
      : `열린 공고 스냅샷 build ${snapshot.buildId} · ${snapshot.calcVersion} · ${kstDateTime(snapshot.computedAt!)} 산출`,
    snapshot.regionScheme === null ? null : `지역 체계 ${snapshot.regionScheme}`,
    summary.buildId === null ? '기관 회차 요약 없음' : `기관 회차 요약 build ${summary.buildId} · ${summary.calcVersion}`
  ];
  return parts.filter((part): part is string => part !== null).join(' · ');
}

// build가 없으면 목록이 비어 있어도 "조건에 맞는 공고가 없다"고 말할 수 없다. 그래서 build를 먼저 본다.
function viewOf(response: OpenAuctionListV1Response, nowIso: string): OpenAuctionListView {
  if (response.meta.openAuctionSnapshotBuild.buildId === null) return { kind: 'no-snapshot' };
  if (response.auctions.length === 0) return { kind: 'empty' };
  return { kind: 'list', rows: response.auctions.map((auction) => presentOpenAuction(auction, nowIso)) };
}

export function presentOpenAuctionList(response: OpenAuctionListV1Response, nowIso: string): OpenAuctionListPresentation {
  return {
    view: viewOf(response, nowIso),
    sampleCount: response.meta.sampleCount,
    eligibilityMatchedCount: response.meta.eligibilityMatchedCount,
    eligibilityUnobservedCount: response.meta.eligibilityUnobservedCount,
    asOfText: kstDateTime(response.meta.asOf),
    lineageText: lineageText(response),
    nextCursor: response.nextCursor
  };
}
