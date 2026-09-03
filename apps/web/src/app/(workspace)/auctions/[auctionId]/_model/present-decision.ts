/** @module 책임: 공고 계약 응답을 결정 화면의 헤더·배너·rail이 그대로 쓰는 표시 문자열로 바꾼다. */
import { Temporal } from '@eatbid/domain';
import type { AuctionV1Response } from '@eatbid/contracts/api/v1/auctions';

import { formatWon } from './bid-rate';
import { deriveRailState, type RailState } from './rail-state';

export type DecisionPresentation = {
  readonly identity: AuctionV1Response['identity'];
  readonly provenance: AuctionV1Response['provenance'];
  readonly baseAmount: { readonly raw: string; readonly text: string };
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

function spanText(fromIso: string, toIso: string): string {
  const from = Temporal.Instant.from(fromIso);
  const to = Temporal.Instant.from(toIso);
  const minutes = Math.round((to.epochMilliseconds - from.epochMilliseconds) / 60_000);
  const hours = Math.floor(minutes / 60);
  return `${hours}시간 ${minutes % 60}분`;
}

function remainingText(schedule: AuctionV1Response['schedule'], state: RailState, nowIso: string): string {
  if (state === 'open' && schedule.deadlineAt) return spanText(nowIso, schedule.deadlineAt);
  if (state === 'closed' && schedule.openedAt) return `개찰 ${spanText(schedule.openedAt, nowIso)} 전`;
  return '미확인';
}

export function presentDecision(response: AuctionV1Response, nowIso: string): DecisionPresentation {
  const railState = deriveRailState(response.schedule, nowIso);
  const [wholeAmount] = response.pricing.baseAmount.amount.split('.');
  return {
    identity: response.identity,
    provenance: response.provenance,
    baseAmount: { raw: response.pricing.baseAmount.amount, text: formatWon(wholeAmount) },
    railState,
    banner: {
      announcedAt: kst(response.schedule.announcedAt),
      deadlineAt: kst(response.schedule.deadlineAt),
      openedAt: kst(response.schedule.openedAt),
      remaining: remainingText(response.schedule, railState, nowIso)
    }
  };
}
