/** @module 책임: 열린 공고 목록 계약 응답을 오늘 화면 카드 목록이 그대로 쓰는 표시값(KST 마감·D-day·금액·미확인 문구·(기관, 하한율) 요약)으로 바꾼다. */
import { Temporal } from '@eatbid/domain';
import { SOLO_BID_NOT_ALLOWED_CODE, type OpenAuction, type OpenAuctionListV1Response } from '@eatbid/contracts/api/v1/auctions';

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
  /** 원천이 표시하는 공고 제목이다. 행 둘째 줄이며 상세를 아직 따지 않은 공고는 null이다(EAT-260). */
  readonly title: string | null;
  /** 원천이 표시하는 공고번호다. 표시·복사용이며 상세를 아직 따지 않은 공고는 null이다(EAT-248). */
  readonly displayBidNo: string | null;
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
    // `오늘`·`내일`·`사흘 뒤`처럼 색과 함께 읽히는 텍스트다. 색만으로 상태를 말하지 않는다(screen-system §11).
    readonly label: string;
    /**
     * KST 시각만이다. 날짜는 행이 아니라 그 행이 속한 마감일 묶음 머리가 말한다 — 스무 행이 같은 날에
     * 몰리는 목록에서 행마다 날짜를 적으면 같은 글자가 스무 번 서고 시각이 안 읽힌다.
     */
    readonly clockText: string;
    readonly dDay: number | null;
    /** wire instant 그대로다. 마감 시각 묶음이 남은 시간을 셀 때 쓰고 화면에는 이 값이 직접 서지 않는다. */
    readonly at: string | null;
  };
  /**
   * 관측된 참여 수다. `0`은 빈 문자열이다 — 값을 버리는 것이 아니라 전면에 세우지 않는 것이다(사용자 결정
   * 2026-09-16). 단독입찰을 허용하지 않는 공고가 대부분이라(표본 30건 중 29건) 0곳은 기회가 아니라 혼자
   * 들어가면 유찰이라는 신호인데, 그 조건을 아직 읽지 않아 화면이 그 사실을 옆에 적어 줄 수 없다. 못 센
   * 판(null)은 `—`라 둘이 섞이지 않는다.
   */
  readonly bidCountText: string;
  /**
   * 단독입찰 처리 방법이다. **참여 0곳의 뜻을 바꾼다** — `not-allowed`면 혼자 들어가면 유찰이라 0곳은
   * 기회가 아니다(실측 181,150건 중 허용안함 180,703). boolean으로 접지 않는 이유는 `unknown`(eat-v4 전
   * 해석)과 `allowed`가 다른 사실이고 화면이 할 말도 다르기 때문이다(AGENTS 3).
   */
  readonly soloBid: 'not-allowed' | 'allowed' | 'unknown';
  readonly orgSummary: {
    readonly attemptCount: number;
    readonly medianListText: string;
    readonly listCountSampleCount: number;
    /**
     * 같은 하한 코호트의 직전 회차다. 명단 수와 개찰일만 싣고 낙찰 투찰률은 싣지 않는다 — 같은 값이
     * 행마다 서면 앵커링이다(decision-support §11). 실측으로 직전 회차는 보통(중앙값)에서 30% 넘게
     * 벗어나는 행이 51.6%라 중앙값 옆에 따로 둘 값어치가 있다(2026-09-16).
     */
    readonly lastRound:
      | { readonly kind: 'observed'; readonly listText: string; readonly dateText: string }
      // 없는 이유가 둘이고 사용자가 할 일이 다르다. 같은 하한에서 본 회차가 아예 없는 것과, 회차는
      // 있는데 개찰 시각을 관측한 것이 없는 것을 한 문구로 합치면 화면이 없는 사실을 말한다(AGENTS 3).
      | { readonly kind: 'none'; readonly text: string };
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
  readonly lineageLines: readonly string[];
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

/**
 * 남은 날을 한국어 날짜 세는 말로 적는다. `D-3`은 눈금이지 말이 아니라서 `사흘 뒤`보다 늦게 읽힌다.
 * 열흘을 넘으면 세는 말이 오히려 낯설어져 숫자로 돌아간다.
 */
const DAY_AWAY = ['오늘', '내일', '모레', '사흘 뒤', '나흘 뒤', '닷새 뒤', '엿새 뒤', '이레 뒤', '여드레 뒤', '아흐레 뒤', '열흘 뒤'] as const;

export function dayAwayText(dDay: number): string {
  if (dDay <= 0) return DAY_AWAY[0];
  return DAY_AWAY[dDay] ?? `${dDay}일 뒤`;
}

function presentCloses(closesAt: string | null, nowIso: string): OpenAuctionRowPresentation['closes'] {
  if (closesAt === null) return { tone: 'unknown', label: '마감 미확인', clockText: '', dDay: null, at: null };
  const dDay = dDayOf(closesAt, nowIso);
  const tone: ClosesTone = dDay <= 0 ? 'today' : dDay === 1 ? 'tomorrow' : 'later';
  return { tone, label: dayAwayText(dDay), clockText: kstTime(closesAt), dDay, at: closesAt };
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

// 개찰일은 날짜까지만이다. 44px 한 줄에서 시각은 자리만 먹고, 직전 회차가 언제였는지는 날로 충분하다.
function kstDate(instant: string): string {
  const zoned = Temporal.Instant.from(instant).toZonedDateTimeISO(KST);
  return `${pad2(zoned.month)}-${pad2(zoned.day)}`;
}

function presentLastRound(summary: NonNullable<OpenAuction['orgSummary']>): NonNullable<OpenAuctionRowPresentation['orgSummary']>['lastRound'] {
  if (summary.attemptCount === 0) return { kind: 'none', text: '같은 하한 회차 없음' };
  const last = summary.lastRound;
  if (last === null) return { kind: 'none', text: '개찰 회차 없음' };
  return {
    kind: 'observed',
    // 명단이 미관측인 회차는 0곳이 아니다. 0으로 적으면 아무도 안 들어온 판이 된다(AGENTS 3).
    listText: last.listCount === null ? '명단 미관측' : `${last.listCount}곳`,
    dateText: kstDate(last.openedAt)
  };
}

function presentOrgSummary(summary: OpenAuction['orgSummary']): OpenAuctionRowPresentation['orgSummary'] {
  if (summary === null) return null;
  return {
    attemptCount: summary.attemptCount,
    medianListText: summary.medianListCount === null ? '—' : String(summary.medianListCount),
    listCountSampleCount: summary.listCountSampleCount,
    lastRound: presentLastRound(summary)
  };
}

/**
 * 저장된 하한율은 `90.000` 꼴이라 소수부의 0은 볼 이유가 없는 정밀도다. 관측된 자릿수가 의미를 갖는
 * 경우(`88.500`)는 그대로 남기고 뒤따르는 0만 뗀다. 반올림하지 않는다.
 *
 * 행과 요약이 같은 문자열을 만들어야 `드문 하한` 집합이 행에 붙는다. 그래서 이 함수 하나가 두 곳의
 * 표기를 소유한다.
 */
export function formatFloorRate(value: string): string {
  if (!value.includes('.')) return value;
  return value.replace(/0+$/, '').replace(/\.$/, '');
}

/** 하한율을 관측하지 못한 행이 쓰는 표시값이다. 0이나 90으로 채우면 화면이 없는 사실을 말한다(AGENTS 3). */
export const FLOOR_RATE_UNKNOWN = '미확인';

export function presentOpenAuction(auction: OpenAuction, nowIso: string): OpenAuctionRowPresentation {
  return {
    auctionAttemptId: auction.auctionAttemptId,
    href: `/auctions/${encodeURIComponent(auction.auctionAttemptId)}`,
    organization: presentOrganization(auction.organization),
    itemLabel: auction.itemLabel,
    title: auction.title,
    displayBidNo: auction.displayBidNo,
    // 관측되지 않은 하한율을 0이나 90으로 채우면 화면이 없는 사실을 말한다(AGENTS 3).
    floorRateText: auction.floorRate === null ? FLOOR_RATE_UNKNOWN : formatFloorRate(auction.floorRate.value),
    region: presentRegion(auction.region),
    eligibilityText: presentEligibility(auction.eligibilityAreas),
    baseAmountText: auction.baseAmount === null ? '미확인' : formatAmountText(auction.baseAmount.amount),
    closes: presentCloses(auction.closesAt, nowIso),
    bidCountText: auction.bidCount === null ? '—' : auction.bidCount === 0 ? '' : String(auction.bidCount),
    soloBid: auction.soloBidMethod === null
      ? 'unknown'
      : auction.soloBidMethod.code === SOLO_BID_NOT_ALLOWED_CODE ? 'not-allowed' : 'allowed',
    orgSummary: presentOrgSummary(auction.orgSummary)
  };
}

/**
 * 계보를 한 문장으로 잇지 않고 줄로 나눈다. 780px 본문에서 한 문장은 두 줄로 넘쳐 표 위가 어수선해지고,
 * 줄바꿈 자리가 폭에 따라 달라져 어디까지가 스냅샷 얘기인지 흐려진다.
 *
 * 지역 체계를 빼지 않는 이유는 eaT 공고지역·참가제한지역·행안부 행정구역이 서로 다른 체계이고, 어느
 * 체계로 번역된 build인지가 목록의 지역 축이 무엇을 뜻하는지를 정하기 때문이다(AGENTS 6, ADR 0035).
 */
function lineageLines(response: OpenAuctionListV1Response): readonly string[] {
  const snapshot = response.meta.openAuctionSnapshotBuild;
  const summary = response.meta.orgRoundSummaryBuild;
  const lines = [
    snapshot.buildId === null
      ? '열린 공고 스냅샷 없음'
      : `열린 공고 스냅샷 build ${snapshot.buildId} · ${snapshot.calcVersion} · ${kstDateTime(snapshot.computedAt!)} 산출`,
    snapshot.regionScheme === null ? null : `지역 체계 ${snapshot.regionScheme}`,
    summary.buildId === null ? '기관 회차 요약 없음' : `기관 회차 요약 build ${summary.buildId} · ${summary.calcVersion}`
  ];
  return lines.filter((line): line is string => line !== null);
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
    lineageLines: lineageLines(response),
    nextCursor: response.nextCursor
  };
}
