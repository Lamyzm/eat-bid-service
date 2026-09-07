/** @module 책임: 공고 계약 응답을 결정 화면의 헤더·배너·rail이 그대로 쓰는 표시 문자열로 바꾼다. */
import { Temporal } from '@eatbid/domain';
import type { AuctionV1Response } from '@eatbid/contracts/api/v1/auctions';

import { formatWon } from './bid-rate';
import { deriveRailState, type RailState } from './rail-state';

export type DecisionPresentation = {
  readonly identity: AuctionV1Response['identity'];
  readonly provenance: AuctionV1Response['provenance'];
  /** 공고 시각 wire instant 그대로다. 회차 간격 계산은 배너 표시 문자열이 아니라 이 값으로 한다(AGENTS 15). */
  readonly announcedAt: string;
  readonly baseAmount: { readonly raw: string; readonly text: string };
  readonly plannedAmount: { readonly text: string };
  // 헤더가 읽는 표시 문자열이다. 코호트를 만드는 원값은 `decision-cohort.ts`가 계약 응답에서
  // 직접 읽는다. 표시용으로 다듬은 문자열을 되파싱해 의미를 되살리지 않는다(AGENTS 15).
  readonly floorRateText: string;
  readonly itemLabelText: string;
  /** 공고지역 시도·시군구의 관측 라벨을 이은 소재지 문자열이다. 코드는 코호트 몫이고 여기는 표시만이다. */
  readonly locationText: string;
  readonly participation: {
    /** "4곳" 또는 "미확인". 목록이 표시한 BID_CNT 관측이지 우리가 센 수가 아니다(ADR 0030). */
    readonly countText: string;
    /** "어제보다 +2". 하루 전 관측이 없으면 null이며 증감을 지어내지 않는다. */
    readonly deltaText: string | null;
    /** 최신 관측 시각(KST). 열린 공고의 참여 수는 시각 없이는 사실이 아니다. */
    readonly observedAtText: string | null;
  };
  readonly railState: RailState;
  readonly banner: {
    readonly announcedAt: string;
    readonly deadlineAt: string;
    readonly openedAt: string;
    readonly remaining: string;
  };
};

const pad2 = (value: number): string => value.toString().padStart(2, '0');

/** wire instant를 KST `MM-DD HH:mm`으로. `Temporal.ZonedDateTimeISO` 필드를 직접 읽으므로 ambient `Date`나
 * 로케일 구현체별 Intl 자정 표기 차이(en 계열이 "24"를 낼 수 있는 문제)에 기대지 않는다. */
function kst(instant: string | null): string {
  if (!instant) return '미확인';
  const zoned = Temporal.Instant.from(instant).toZonedDateTimeISO('Asia/Seoul');
  return `${pad2(zoned.month)}-${pad2(zoned.day)} ${pad2(zoned.hour)}:${pad2(zoned.minute)}`;
}

// 시(정수부)가 24를 넘으면 자릿수가 커져 오히려 못 읽으므로 일 단위로 접는다(분은 버린다). 시가 0이면
// (1시간 미만) 시 표기 없이 분만 보인다.
function spanText(fromIso: string, toIso: string): string {
  const from = Temporal.Instant.from(fromIso);
  const to = Temporal.Instant.from(toIso);
  const minutes = Math.round((to.epochMilliseconds - from.epochMilliseconds) / 60_000);
  const hours = Math.floor(minutes / 60);
  const remainderMinutes = minutes % 60;
  if (hours > 24) return `${Math.floor(hours / 24)}일 ${hours % 24}시간`;
  if (hours < 1) return `${remainderMinutes}분`;
  return `${hours}시간 ${remainderMinutes}분`;
}

// "개찰 …전" 접두사는 배너가 라벨("개찰 후")로 이미 문맥을 주므로 값 자체에는 붙이지 않는다.
function remainingText(schedule: AuctionV1Response['schedule'], state: RailState, nowIso: string): string {
  if (state === 'open' && schedule.deadlineAt) return spanText(nowIso, schedule.deadlineAt);
  if (state === 'closed' && schedule.openedAt) return spanText(schedule.openedAt, nowIso);
  return '미확인';
}

// wire 소수부가 0이면 사용자가 볼 이유가 없는 정밀도라 생략하고, 0이 아니면 관측된 값 그대로 보인다
// (반올림하지 않는다).
function formatAmountText(amount: string): string {
  const [whole, fraction = ''] = amount.split('.');
  const paddedFraction = (fraction + '00').slice(0, 2);
  return paddedFraction === '00' ? formatWon(whole) : `${formatWon(whole)}.${paddedFraction}`;
}

// 시도·시군구 중 라벨이 관측된 것만 잇는다. 코드는 있는데 라벨이 없는 축은 코드 문자열을 사람에게 보이지
// 않는다 — "48120"은 소재지가 아니라 체계 안의 코드다(AGENTS 2·6).
function locationText(location: AuctionV1Response['location']): string {
  const labels = [location?.sido?.label, location?.sigungu?.label].filter((label): label is string => typeof label === 'string');
  return labels.length === 0 ? '미확인' : labels.join(' ');
}

function participationText(participation: AuctionV1Response['participation']): DecisionPresentation['participation'] {
  if (participation === null) return { countText: '미확인', deltaText: null, observedAtText: null };
  const { latest, dayEarlier } = participation;
  const delta = dayEarlier === null ? null : latest.bidCount - dayEarlier.bidCount;
  return {
    countText: `${latest.bidCount}곳`,
    // 증감 0도 사실이다. "+0"은 하루 사이 늘지 않았다는 관측이라 그대로 적는다.
    deltaText: delta === null ? null : `어제보다 ${delta >= 0 ? '+' : ''}${delta}`,
    observedAtText: kst(latest.observedAt)
  };
}

export function presentDecision(response: AuctionV1Response, nowIso: string): DecisionPresentation {
  const now = Temporal.Instant.from(nowIso);
  const railState = deriveRailState(response.schedule, now);
  return {
    identity: response.identity,
    provenance: response.provenance,
    announcedAt: response.schedule.announcedAt,
    baseAmount: { raw: response.pricing.baseAmount.amount, text: formatAmountText(response.pricing.baseAmount.amount) },
    plannedAmount: { text: response.pricing.plannedAmount ? formatAmountText(response.pricing.plannedAmount.amount) : '미확인' },
    // 관측되지 않은 하한율을 0이나 90으로 채우면 화면이 없는 사실을 말한다(AGENTS 3).
    floorRateText: response.terms?.floorRate?.value ?? '미확인',
    itemLabelText: response.classification?.itemLabel ?? '품목 미확인',
    locationText: locationText(response.location),
    participation: participationText(response.participation),
    railState,
    banner: {
      announcedAt: kst(response.schedule.announcedAt),
      deadlineAt: kst(response.schedule.deadlineAt),
      openedAt: kst(response.schedule.openedAt),
      remaining: remainingText(response.schedule, railState, nowIso)
    }
  };
}
