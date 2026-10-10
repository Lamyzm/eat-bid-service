/**
 * @module 책임: 등록 사업자가 최근에 넣은 공고들의 실제 경쟁 투찰 배치와 예정가격 추첨 분포로, 그 시장에서 낙찰 기대가 가장 큰
 * 배수 한두 개를 고르고 원 단위 금액으로 바꾸는 계산을 소유한다. 방법 상수와 근거 수치는 `market-position-pick-table.ts`가 소유한다.
 *
 * 전국 규칙과 나눈 이유는 바뀌는 이유가 다르기 때문이다. 전국 규칙은 몇 해치 기록으로 한 번 고른 고정 표이고, 이 계산은
 * 요청한 워크스페이스의 시장 기록을 매번 다시 읽어 고른다. 단골 업체의 자리가 해마다 움직여 고정 표가 낡는 시장을 위한 것이다
 * (실험 기록 §14).
 */
import type { BaseRelativeBidRate, BidRate, CanonicalDecimal, Money } from "@eatbid/domain";

import { positionAmount, positionBaseRelativeRate } from "./bid-position-rule";

declare const floorRelativeRatioBrand: unique symbol;

/**
 * 투찰 금액 ÷ (기초금액 × 낙찰하한율)이다. 추천 배수와 같은 축이라 둘을 바로 견줄 수 있다. 기초금액 기준 하한액보다 높게 낸
 * 투찰은 1을 넘으므로 `Ratio`(1 이하)로 담지 않는다. 소수 여덟째 자리 고정이다.
 */
export type FloorRelativeRatio = CanonicalDecimal & { readonly [floorRelativeRatioBrand]: "FloorRelativeRatio" };

export const FLOOR_RELATIVE_RATIO_SCALE = 8;

export function floorRelativeRatio(value: CanonicalDecimal): FloorRelativeRatio {
  const fraction = value.split(".")[1] ?? "";
  if (fraction.length !== FLOOR_RELATIVE_RATIO_SCALE) {
    throw new RangeError(`하한 기준 투찰 비율은 소수 ${FLOOR_RELATIVE_RATIO_SCALE}자리여야 한다`);
  }
  return value as FloorRelativeRatio;
}

/** 예정가격 ÷ 기초금액의 누적분포다. 매듭 간격은 0.0001이고 매듭 사이는 선형으로 잇는다. */
export interface PlannedRatioDistribution {
  readonly version: string;
  readonly sourceRounds: number;
  readonly firstKnotTenThousandths: number;
  readonly lastKnotTenThousandths: number;
  readonly cumulativePartsPerMillion: readonly number[];
}

/** 후보 배수 격자 `[from, to]`이며 단위는 0.0001이다. */
export interface CandidateMultiples {
  readonly fromTenThousandths: number;
  readonly toTenThousandths: number;
  readonly stepTenThousandths: number;
}

/** 시장 공고 한 건이다. 등록 사업자 자신의 투찰은 빠져 있다 — 그 자리를 추천 금액으로 바꿔 넣는다고 보고 계산한다. */
export interface MarketRound {
  readonly competitorRatios: readonly FloorRelativeRatio[];
}

export interface MarketPick {
  /** 낮은 배수부터다. 소수 넷째 자리 문자열이며 금액 계산에는 정수 계수로만 쓴다. */
  readonly multiples: readonly string[];
  /**
   * 고른 기간 안의 기대 낙찰 합이다. 고른 자료로 잰 값이라 낙관적이어서 공개 응답에 싣지 않는다 — 분석 스크립트와 같은
   * 답을 내는지 대조하는 데만 쓴다. 표본 밖 근거는 방법 표의 걸어가기·봉인 채점이다.
   */
  readonly inSampleExpectedWins: number;
}

function multipleText(tenThousandths: number): string {
  return `${Math.floor(tenThousandths / 10000)}.${String(tenThousandths % 10000).padStart(4, "0")}`;
}

/**
 * 누적분포를 선형 보간으로 읽는다. 확률 적분은 근사 계산이라 부동소수로 한다 — 금액은 여기서 나온 배수를 정수 계수로만
 * 곱하므로 이 근사가 금액의 원 단위에 새지 않는다.
 */
function cumulativeAt(distribution: PlannedRatioDistribution, value: number): number {
  const parts = distribution.cumulativePartsPerMillion;
  const position = value * 10000 - distribution.firstKnotTenThousandths;
  const last = parts.length - 1;
  if (position <= 0) return parts[0]! / 1e6;
  if (position >= last) return parts[last]! / 1e6;
  const knot = Math.floor(position);
  const fraction = position - knot;
  return (parts[knot]! + fraction * (parts[knot + 1]! - parts[knot]!)) / 1e6;
}

/**
 * 한 장이면 그 금액, 두 장이면 두 금액의 낙찰 확률 합이 가장 큰 배수를 고른다. 내 금액 x로 낙찰하는 것은 예정가격 비율이
 * (바로 아래 경쟁 투찰, x] 안에 뽑힐 때이고, 두 번째 금액은 첫 금액이 이미 덮은 구간을 빼고 센다. 같은 값이면 낮은 배수를
 * 먼저 고른다 — 분석 스크립트(numpy argmax)와 같은 순서다.
 */
export function pickMarketMultiples(input: {
  readonly rounds: readonly MarketRound[];
  readonly tickets: 1 | 2;
  readonly candidates: CandidateMultiples;
  readonly distribution: PlannedRatioDistribution;
}): MarketPick {
  const { candidates, distribution } = input;
  const grid: number[] = [];
  for (let value = candidates.fromTenThousandths; value <= candidates.toTenThousandths; value += candidates.stepTenThousandths) {
    grid.push(value);
  }
  const size = grid.length;
  const gridCdf = grid.map((value) => cumulativeAt(distribution, value / 10000));
  const single = new Float64Array(size);
  const pair = new Float64Array(size * size);
  const belowCdf = new Float64Array(size);
  const own = new Float64Array(size);
  for (const round of input.rounds) {
    const sorted = round.competitorRatios.map(Number).sort((left, right) => left - right);
    let index = 0;
    for (let g = 0; g < size; g += 1) {
      const candidate = grid[g]! / 10000;
      while (index < sorted.length && sorted[index]! < candidate) index += 1;
      belowCdf[g] = index === 0 ? 0 : cumulativeAt(distribution, sorted[index - 1]!);
      own[g] = gridCdf[g]! - belowCdf[g]!;
      single[g] = single[g]! + own[g]!;
    }
    if (input.tickets === 2) {
      for (let low = 0; low < size; low += 1) {
        for (let high = low + 1; high < size; high += 1) {
          const cell = low * size + high;
          pair[cell] = pair[cell]! + own[low]! + Math.max(0, gridCdf[high]! - Math.max(belowCdf[high]!, gridCdf[low]!));
        }
      }
    }
  }
  if (input.tickets === 1) {
    let best = 0;
    for (let g = 1; g < size; g += 1) if (single[g]! > single[best]!) best = g;
    return { multiples: [multipleText(grid[best]!)], inSampleExpectedWins: single[best]! };
  }
  let bestLow = 0;
  let bestHigh = 1;
  for (let low = 0; low < size; low += 1) {
    for (let high = low + 1; high < size; high += 1) {
      if (pair[low * size + high]! > pair[bestLow * size + bestHigh]!) {
        bestLow = low;
        bestHigh = high;
      }
    }
  }
  return {
    multiples: [multipleText(grid[bestLow]!), multipleText(grid[bestHigh]!)],
    inSampleExpectedWins: pair[bestLow * size + bestHigh]!,
  };
}

export type MarketPickNotApplicableReason =
  | "floor-rate-unobserved"
  | "floor-rate-outside-market-pick"
  | "no-linked-business"
  | "market-rounds-below-minimum"
  | "market-data-unavailable";

export interface MarketPickPosition {
  readonly order: number;
  readonly amount: Money;
  readonly baseRelativeRate: BaseRelativeBidRate;
}

export type MarketPickResult =
  | {
    readonly state: "applicable";
    readonly marketRounds: number;
    readonly linkedBusinesses: number;
    /** 등록 사업자가 둘 이상이면 두 장(낮은 배수가 1번), 하나면 한 장이다. */
    readonly positions: readonly MarketPickPosition[];
    /** 한 곳만 넣는 공고에 쓸 금액이다. 두 장의 1번과 다르다 — 한 장일 때 최선 자리를 따로 고른다. */
    readonly single: MarketPickPosition;
  }
  | {
    readonly state: "not-applicable";
    readonly reasons: readonly MarketPickNotApplicableReason[];
    /** 시장을 읽지 못했으면(사업자 없음·하한율 밖) `null`이다. 0과 섞으면 "읽었는데 없었다"로 보인다. */
    readonly marketRounds: number | null;
  };

function positionsOf(baseAmount: Money, floorRate: BidRate, multiples: readonly string[]): MarketPickPosition[] {
  return multiples.map((multiple, index) => ({
    order: index + 1,
    amount: positionAmount(baseAmount, floorRate, multiple),
    baseRelativeRate: positionBaseRelativeRate(floorRate, multiple),
  }));
}

/** 고른 배수를 전국 규칙과 같은 식(기초금액 × 낙찰하한율 × 배수, 원 단위 올림)으로 금액으로 바꾼다. */
export function marketPositionBids(input: {
  readonly baseAmount: Money;
  readonly floorRate: BidRate;
  readonly pick: MarketPick;
  readonly single: MarketPick;
  readonly marketRounds: number;
  readonly linkedBusinesses: number;
}): MarketPickResult {
  return {
    state: "applicable",
    marketRounds: input.marketRounds,
    linkedBusinesses: input.linkedBusinesses,
    positions: positionsOf(input.baseAmount, input.floorRate, input.pick.multiples),
    single: positionsOf(input.baseAmount, input.floorRate, input.single.multiples)[0]!,
  };
}
