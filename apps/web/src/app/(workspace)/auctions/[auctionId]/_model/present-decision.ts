/** @module 책임: 공고 계약 응답을 결정 화면의 헤더·배너·rail이 그대로 쓰는 표시 문자열로 바꾼다. */
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

// hour12: false만으로는 Intl.DateTimeFormat이 자정에 "24"를 낼 수 있다(en 로케일 구현체 계열).
// hourCycle: 'h23'을 명시해 00~23만 나오게 고정한다.
const KST = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, hourCycle: 'h23'
});

/** wire instant를 KST `MM-DD HH:mm`으로. 표시 전용이라 Date를 만들되 밖으로 내보내지 않는다. */
function kst(instant: string | null): string {
  if (!instant) return '미확인';
  const parts = KST.formatToParts(new Date(instant));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

function spanText(fromIso: string, toIso: string): string {
  const minutes = Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 60_000);
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
