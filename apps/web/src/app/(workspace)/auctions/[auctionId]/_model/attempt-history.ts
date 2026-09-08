/** @module 책임: 기관 회차 이력 계약 응답을 결정 화면 표가 그대로 렌더링할 표시 행·요약 문자열로 바꾸고, 보고 있는 공고 자신만 표에서 뺀다. */
import { Temporal } from '@eatbid/domain';
import type {
  MartCoverage,
  OrganizationAuctionAttempt,
  OrganizationAuctionAttemptsV1Response
} from '@eatbid/contracts/api/v1/organizations';

import { formatWon, toMilli, toMilliCeiling } from './bid-rate';

export type HistoryRow = {
  readonly attemptId: string;
  readonly openedAt?: string | null;
  /** wire instant 그대로다. 헤더의 발주 주기·배너의 지난 공고는 이 값으로 간격을 재며 표시 문자열을 되파싱하지 않는다(AGENTS 15). */
  readonly announcedAt: string;
  readonly openedText: string;
  readonly openedYear: string;
  /** 흐름 차트 x축 달 라벨용 KST `YY-MM`. 같은 달인지 비교하는 열쇠이기도 하므로 표시 문자열에서 되파싱하지 않는다. */
  readonly openedMonthText: string;
  /** 개찰일(개찰 전이면 공고일)의 KST 달력 날짜를 1970-01-01부터 센 날 수. 회차 사이 간격을 일 단위로 세는 용도다. */
  readonly openedKstDay: number;
  /** KST `YYYY-MM`. 크게 보기 부제의 기간 범위용이며 `openedText`를 되파싱하지 않는다(AGENTS 15). */
  readonly openedMonth: string;
  readonly itemLabel: string;
  readonly floorRateText: string | null;
  readonly baseAmountText: string;
  readonly itemCodeValueId: string | null;
  readonly awardMethodCodeValueId?: string | null;
  readonly winRateText: string | null;
  readonly winRateMilli: bigint | null;
  /** 같은 낙찰의 투찰률 축(분모 기초금액) 표현이다. 손잡이와 같은 축이라 판정은 이 값과 견준다. */
  readonly awardedBidRateText: string | null;
  readonly awardedBidRateMilli: bigint | null;
  readonly secondRateText: string | null;
  readonly dayFloorText: string | null;
  readonly dayFloorMilli: bigint | null;
  readonly winnerText: string;
  readonly listCount: number | null;
  readonly belowDayFloorCount: number | null;
  readonly isSelectedItem: boolean;
};

export type HistoryPresentation = {
  readonly organizationId: string;
  readonly rows: readonly HistoryRow[];
  /** 계약의 keyset cursor 그대로. null이면 이력 끝이라 크게 보기가 더 부르지 않는다. */
  readonly nextCursor: string | null;
  readonly sampleCount: number;
  readonly buildId: string | null;
  readonly sourceReleaseId: string | null;
  readonly computedAtText: string | null;
  readonly calcVersion: string | null;
  readonly coverage: MartCoverage | null;
  readonly regionScheme: string | null;
  readonly selectedItem: { readonly codeValueId: string; readonly label: string } | null;
  readonly cohort?: OrganizationAuctionAttemptsV1Response['meta']['cohort'];
};

const pad2 = (value: number): string => value.toString().padStart(2, '0');

// wire instant를 KST `YY-MM-DD`로. present-decision.ts의 `MM-DD HH:mm`과 달리 표는 행이 많아
// 연도를 함께 보여야 회차를 구분할 수 있다.
function kstDate(instant: string): string {
  const zoned = Temporal.Instant.from(instant).toZonedDateTimeISO('Asia/Seoul');
  return `${pad2(zoned.year % 100)}-${pad2(zoned.month)}-${pad2(zoned.day)}`;
}

function kstMinute(instant: string): string {
  const zoned = Temporal.Instant.from(instant).toZonedDateTimeISO('Asia/Seoul');
  return `${pad2(zoned.month)}-${pad2(zoned.day)} ${pad2(zoned.hour)}:${pad2(zoned.minute)}`;
}

// 개찰 전 회차는 openedAt이 없어 공고일만 안다. 개찰일과 구분되도록 ' 공고' 접미사를 붙인다.
function openedText(attempt: OrganizationAuctionAttempt): string {
  if (attempt.openedAt) return kstDate(attempt.openedAt);
  return `${kstDate(attempt.announcedAt)} 공고`;
}

// rehearsal.ts의 byYear 집계가 쓰는 필드다. openedText는 표시용으로 세기를 잘라낸 2자리 문자열이라
// 다시 파싱해 의미(연도)를 되살리면 안 된다(규칙 15). Temporal로 직접 KST 4자리 연도를 만든다.
function openedYear(attempt: OrganizationAuctionAttempt): string {
  const instant = attempt.openedAt ?? attempt.announcedAt;
  return Temporal.Instant.from(instant).toZonedDateTimeISO('Asia/Seoul').year.toString();
}

// 흐름 차트의 달 경계도 표와 같은 KST다. openedText를 잘라 쓰면 ' 공고' 접미사 행에서 달이 어긋난다.
function openedMonthText(attempt: OrganizationAuctionAttempt): string {
  const zoned = Temporal.Instant.from(attempt.openedAt ?? attempt.announcedAt).toZonedDateTimeISO('Asia/Seoul');
  return `${pad2(zoned.year % 100)}-${pad2(zoned.month)}`;
}

const KST_DAY_EPOCH = Temporal.PlainDate.from('1970-01-01');

// 회차 간격은 client 컴포넌트(레일 패널)가 세는데 `@eatbid/domain` runtime은 client bundle에 넣지 않으므로
// 날짜 산술은 여기서 끝내고 정수 날 수만 넘긴다. openedText('YY-MM-DD')를 다시 파싱하지 않는다(규칙 15).
function openedKstDay(attempt: OrganizationAuctionAttempt): number {
  const instant = attempt.openedAt ?? attempt.announcedAt;
  const date = Temporal.Instant.from(instant).toZonedDateTimeISO('Asia/Seoul').toPlainDate();
  return KST_DAY_EPOCH.until(date, { largestUnit: 'days' }).days;
}

function openedMonth(attempt: OrganizationAuctionAttempt): string {
  const zoned = Temporal.Instant.from(attempt.openedAt ?? attempt.announcedAt).toZonedDateTimeISO('Asia/Seoul');
  return `${zoned.year}-${pad2(zoned.month)}`;
}

// 기초금액 wire는 소수 둘째 자리까지 실린다. 소수부가 0이면 볼 이유가 없는 정밀도라 생략하고, 0이
// 아니면 관측된 값 그대로 보인다(present-decision.ts와 같은 규칙).
function amountText(amount: string): string {
  const [whole, fraction = ''] = amount.split('.');
  const padded = (fraction + '00').slice(0, 2);
  return padded === '00' ? formatWon(whole) : `${formatWon(whole)}.${padded}`;
}

function presentRow(attempt: OrganizationAuctionAttempt, selectedItem: string | null): HistoryRow {
  return {
    attemptId: attempt.attemptId,
    openedAt: attempt.openedAt,
    announcedAt: attempt.announcedAt,
    openedText: openedText(attempt),
    openedYear: openedYear(attempt),
    openedMonthText: openedMonthText(attempt),
    openedKstDay: openedKstDay(attempt),
    openedMonth: openedMonth(attempt),
    itemLabel: attempt.item?.label ?? '미확인',
    floorRateText: attempt.floorRate?.value ?? null,
    baseAmountText: amountText(attempt.baseAmount.amount),
    itemCodeValueId: attempt.item?.codeValueId ?? null,
    awardMethodCodeValueId: attempt.awardMethodCodeValueId ?? null,
    winRateText: attempt.winRate?.value ?? null,
    winRateMilli: attempt.winRate ? toMilli(attempt.winRate.value) : null,
    awardedBidRateText: attempt.awardedBidRate?.value ?? null,
    // 낙찰률은 "이 값 이하면 이겼다"는 경계라 하한과 반대로 내려야 한다. 손잡이가 셋째 자리이므로
    // 넷째 자리를 버린 값과의 `<=` 비교는 넷째 자리를 그대로 둔 비교와 정확히 같다.
    awardedBidRateMilli: attempt.awardedBidRate ? toMilli(attempt.awardedBidRate.value) : null,
    secondRateText: attempt.secondRate?.value ?? null,
    dayFloorText: attempt.dayFloorRate?.value ?? null,
    // 그날 하한은 소수 넷째 자리인데 손잡이는 셋째 자리다. 내림하면 하한 바로 아래 값이 유효로
    // 보이므로 하한 쪽으로 올려 비교한다. 손잡이가 셋째 자리이므로 이 올림은 판정과 정확히 같다.
    dayFloorMilli: attempt.dayFloorRate ? toMilliCeiling(attempt.dayFloorRate.value) : null,
    winnerText: attempt.winnerSupplierPartyId ? `#${attempt.winnerSupplierPartyId}` : '—',
    listCount: attempt.listCount,
    belowDayFloorCount: attempt.belowDayFloorCount,
    isSelectedItem: selectedItem === null || attempt.item?.codeValueId === selectedItem
  };
}

// 선택 품목이 이번 응답에 없으면(예: 다른 회차만 가진 codeValueId) 라벨을 알 수 없으므로 나머지
// 필드와 같은 규약으로 '미확인'을 보인다.
function resolveSelectedItem(
  attempts: readonly OrganizationAuctionAttempt[],
  selectedItem: string
): { readonly codeValueId: string; readonly label: string } {
  const match = attempts.find((attempt) => attempt.item?.codeValueId === selectedItem);
  return { codeValueId: selectedItem, label: match?.item?.label ?? '미확인' };
}

/**
 * 어떤 회차가 "과거"인지는 화면이 정하지 않는다. 개찰 여부 필터는 계약 기본값(`opened=only`)과 서버
 * clock이 걸고, 여기서는 응답 행을 그대로 싣되 보고 있는 공고 자신만 뺀다 — 이미 개찰된 공고를 열어
 * 보면 그 회차가 자기 과거 표에 다시 나타나기 때문이다(EAT-81). 표본 수는 응답 meta의 사실이므로
 * 자신을 뺐다고 고쳐 쓰지 않는다.
 */
export function presentHistory(
  response: OrganizationAuctionAttemptsV1Response,
  selectedItem: string | null,
  options: { readonly currentAttemptId?: string } = {}
): HistoryPresentation {
  const others = options.currentAttemptId === undefined
    ? response.attempts
    : response.attempts.filter((attempt) => attempt.attemptId !== options.currentAttemptId);
  return {
    organizationId: response.organizationId,
    rows: others.map((attempt) => presentRow(attempt, selectedItem)),
    nextCursor: response.nextCursor,
    sampleCount: response.meta.sampleCount,
    buildId: response.meta.buildId,
    sourceReleaseId: response.meta.sourceReleaseId,
    computedAtText: response.meta.computedAt ? kstMinute(response.meta.computedAt) : null,
    calcVersion: response.meta.calcVersion,
    coverage: response.meta.coverage,
    regionScheme: response.meta.regionScheme,
    selectedItem: selectedItem === null ? null : resolveSelectedItem(response.attempts, selectedItem),
    cohort: response.meta.cohort
  };
}
