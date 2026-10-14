/**
 * @module 책임: 예정가격 추첨 분포(예정가격 ÷ 기초금액)를 뒤집어, 하한율을 곱한 하한선 기초금액 대비 분위수 목록을 만든다.
 *
 * 분포를 새로 만들지 않고 맞춤 금액·복기가 쓰는 판을 그대로 뒤집는 이유는 같은 추첨을 두 벌로 두지 않기 위해서다
 * (PDR-0009). 하한선 자리는 이 분위수로 점 20개·하한 미달 확률·추첨만 돌린 한 달을 그린다.
 */
import { baseRelativeBidRate, canonicalDecimal, type BaseRelativeBidRate, type BidRate } from "@eatbid/domain";

import type { PlannedRatioDistribution } from "./market-position-pick";

/** 분위수 간격(천분율)과 개수다. 0.005부터 0.995까지 199개라 점 20개(0.025 간격)와 미달 확률 보간을 모두 덮는다. */
export const FLOOR_LINE_QUANTILE_STEP_PERMILLE = 5;
export const FLOOR_LINE_QUANTILE_COUNT = 199;

/**
 * 누적 비율 `probability`(0~1)에 닿는 예정가격 ÷ 기초금액을 매듭 사이 선형 보간으로 찾는다. 확률 적분은 근사 계산이라
 * 부동소수로 하고, 결과는 소수 넷째 자리 기초금액 대비율로만 밖에 낸다 — 금액이 아니라 분포 모양이다.
 */
function plannedRatioAt(distribution: PlannedRatioDistribution, probability: number): number {
  const parts = distribution.cumulativePartsPerMillion;
  const target = probability * 1e6;
  for (let knot = 1; knot < parts.length; knot += 1) {
    const upper = parts[knot]!;
    if (upper < target) continue;
    const lower = parts[knot - 1]!;
    const fraction = upper === lower ? 0 : (target - lower) / (upper - lower);
    return (distribution.firstKnotTenThousandths + knot - 1 + fraction) / 10000;
  }
  return distribution.lastKnotTenThousandths / 10000;
}

/** 하한율(예: 90.000)의 하한선이 기초금액의 몇 %에 떨어지는지 199개 분위수로 낸다. 낮은 쪽부터다. */
export function floorLineQuantiles(distribution: PlannedRatioDistribution, floorRate: BidRate): readonly BaseRelativeBidRate[] {
  const rate = Number(floorRate);
  const out: BaseRelativeBidRate[] = [];
  for (let index = 1; index <= FLOOR_LINE_QUANTILE_COUNT; index += 1) {
    const probability = (index * FLOOR_LINE_QUANTILE_STEP_PERMILLE) / 1000;
    const floorPercent = plannedRatioAt(distribution, probability) * rate;
    out.push(baseRelativeBidRate(canonicalDecimal(floorPercent.toFixed(4), 4)));
  }
  return out;
}
