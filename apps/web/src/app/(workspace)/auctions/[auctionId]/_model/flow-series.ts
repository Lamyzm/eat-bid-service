/** @module 책임: 흐름 차트의 눈금이 어느 축인지 선언하고, 그 축 위에 "내 값" 선을 그을 수 있는 출처와 긋지 않을 때의 이유를 결정한다. */
import type { BidRate } from './bid-rate';
import { parseMyRate } from './present-distribution';

/**
 * 흐름 차트는 회차별 낙찰률(`winRate`)을 잇는 차트라 눈금은 사정률(분모 예정가격)이다. 낙찰이 몰리는
 * 자리가 겹쳐 보이는 축은 이 축뿐이며(PDR-0004), 호가창 사다리와 같은 축이라야 두 화면이 같은 값을
 * 말한다.
 */
export const FLOW_AXIS = { name: '사정률', denominator: '예정가격' } as const;

export type MyRateLine =
  | { readonly kind: 'drawn'; readonly rate: string }
  | { readonly kind: 'withheld'; readonly reason: string };

/**
 * 사정률 눈금 위에 그을 수 있는 "내 값"은 사용자가 사정률로 놓은 값(URL `myRate`)뿐이다. 레일 손잡이의
 * 투찰률은 분모가 기초금액이라 같은 숫자여도 다른 값이고, 마감 전에는 예정가격이 없어 환산할 입력
 * 자체가 없다(PDR-0004, AGENTS 15). 그래서 손잡이 값은 대신 긋지 않고 그 값이 왜 차트에 없는지를
 * 말한다. 손잡이 값과 회차의 비교는 같은 투찰률 축인 `awardedBidRate`와 견주는 과거 회차 표가 맡는다.
 */
export function decideMyRateLine({
  myRate,
  bidRate
}: {
  readonly myRate: string | null;
  readonly bidRate: BidRate;
}): MyRateLine {
  const trimmed = myRate?.trim() ?? '';
  if (trimmed === '') {
    return {
      kind: 'withheld',
      reason:
        `레일의 투찰률 ${bidRate}은 분모가 기초금액이라 ${FLOW_AXIS.name} 눈금에 놓지 않습니다. ` +
        `${FLOW_AXIS.name} 내 값은 비교집단 탭에서 놓고, 손잡이 값과 회차의 비교는 과거 회차 표 마지막 열이 합니다.`
    };
  }
  if (parseMyRate(trimmed) === null) {
    return { kind: 'withheld', reason: `내 값(${FLOW_AXIS.name}) 형식이 맞지 않아 선을 긋지 않습니다. ${FLOW_AXIS.name}은 소수 셋째 자리까지입니다.` };
  }
  return { kind: 'drawn', rate: trimmed };
}
