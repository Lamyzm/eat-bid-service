/** @module 책임: 흐름 차트의 눈금이 어느 축인지와 그 위에 놓는 계열의 이름·축을 선언하고, "내 값" 선을 그을 수 있는 출처와 긋지 않을 때의 이유를 결정한다. */
import type { BidRate } from './bid-rate';
import { parseMyRate } from './present-distribution';

/**
 * 흐름 차트는 회차별 낙찰률(`winRate`)을 잇는 차트라 눈금은 사정률(분모 예정가격)이다. 낙찰이 몰리는
 * 자리가 겹쳐 보이는 축은 이 축뿐이며(PDR-0004), 호가창 사다리와 같은 축이라야 두 화면이 같은 값을
 * 말한다.
 */
export const FLOW_AXIS = { name: '사정률', denominator: '예정가격' } as const;

export type FlowSeriesKey = 'win' | 'runnerUp' | 'myRate' | 'own' | 'otherItems' | 'listCount';

export type FlowSeries = {
  readonly key: FlowSeriesKey;
  readonly name: string;
  /** 사정률 눈금 위의 값인지, 아래 막대 서브차트의 회차별 건수인지. 축이 다른 계열을 한 눈금에 섞지 않는다. */
  readonly axis: 'assessment-rate' | 'count';
};

/**
 * 범례와 차트가 같은 이름을 쓰도록 계열 어휘는 여기 한 곳만 소유한다. 순서가 곧 범례 순서다. 그날 하한은
 * 투찰률 축(분모 기초금액)이라 사정률 눈금 위에 놓을 수 없으므로 계열이 아니며, 왜 없는지는
 * `DAY_FLOOR_WITHHELD_REASON`이 각주로 말한다(PDR-0004).
 */
export const FLOW_SERIES: readonly FlowSeries[] = [
  { key: 'win', name: '낙찰', axis: 'assessment-rate' },
  { key: 'runnerUp', name: '2등', axis: 'assessment-rate' },
  { key: 'myRate', name: '내 값', axis: 'assessment-rate' },
  // 실제 제출은 가정 선 `내 값`과 이름·색·표식이 다르다. 가정을 실제로 이름만 바꿔 부르지 않는다(인계 원문).
  { key: 'own', name: '내 투찰', axis: 'assessment-rate' },
  { key: 'otherItems', name: '다른 품목', axis: 'assessment-rate' },
  { key: 'listCount', name: '명단', axis: 'count' }
];

export const DAY_FLOOR_WITHHELD_REASON =
  `그날 하한은 분모가 기초금액(투찰률)이라 ${FLOW_AXIS.name} 눈금에 놓지 않습니다. 회차별 그날 하한은 과거 회차 표에서 봅니다.`;

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
  readonly bidRate: BidRate | null;
}): MyRateLine {
  const trimmed = myRate?.trim() ?? '';
  if (trimmed === '') {
    // 손잡이가 비어 있으면 값 없이 축의 차이만 말한다. 여기서 숫자를 지어 넣으면 그것이 추천값이 된다(EAT-84).
    const handle = bidRate === null ? '레일의 투찰률은' : `레일의 투찰률 ${bidRate}은`;
    return {
      kind: 'withheld',
      reason:
        `${handle} 분모가 기초금액이라 ${FLOW_AXIS.name} 눈금에 놓지 않습니다. ` +
        `${FLOW_AXIS.name} 내 값은 비교집단 탭에서 놓고, 손잡이 값과 회차의 비교는 과거 회차 표 마지막 열이 합니다.`
    };
  }
  if (parseMyRate(trimmed) === null) {
    return { kind: 'withheld', reason: `내 값(${FLOW_AXIS.name}) 형식이 맞지 않아 선을 긋지 않습니다. ${FLOW_AXIS.name}은 소수 셋째 자리까지입니다.` };
  }
  return { kind: 'drawn', rate: trimmed };
}
