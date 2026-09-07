/** @module 책임: 기관 회차 이력 계약 응답을 결정 화면 표가 그대로 렌더링할 표시 행·요약 문자열로 바꾸고, 보고 있는 공고 자신만 표에서 뺀다. */
import { Temporal } from '@eatbid/domain';
import type {
  MartCoverage,
  OrganizationAuctionAttempt,
  OrganizationAuctionAttemptsV1Response
} from '@eatbid/contracts/api/v1/organizations';

import { toMilli, toMilliCeiling } from './bid-rate';

export type HistoryRow = {
  readonly attemptId: string;
  readonly openedText: string;
  readonly openedYear: string;
  readonly itemLabel: string;
  readonly itemCodeValueId: string | null;
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
  readonly sampleCount: number;
  readonly buildId: string | null;
  readonly sourceReleaseId: string | null;
  readonly computedAtText: string | null;
  readonly calcVersion: string | null;
  readonly coverage: MartCoverage | null;
  readonly regionScheme: string | null;
  readonly selectedItem: { readonly codeValueId: string; readonly label: string } | null;
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

function presentRow(attempt: OrganizationAuctionAttempt, selectedItem: string | null): HistoryRow {
  return {
    attemptId: attempt.attemptId,
    openedText: openedText(attempt),
    openedYear: openedYear(attempt),
    itemLabel: attempt.item?.label ?? '미확인',
    itemCodeValueId: attempt.item?.codeValueId ?? null,
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
    sampleCount: response.meta.sampleCount,
    buildId: response.meta.buildId,
    sourceReleaseId: response.meta.sourceReleaseId,
    computedAtText: response.meta.computedAt ? kstMinute(response.meta.computedAt) : null,
    calcVersion: response.meta.calcVersion,
    coverage: response.meta.coverage,
    regionScheme: response.meta.regionScheme,
    selectedItem: selectedItem === null ? null : resolveSelectedItem(response.attempts, selectedItem)
  };
}
