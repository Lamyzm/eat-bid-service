/**
 * @module 책임: 개찰된 공고 한 건의 사실(기초금액·예정가격·하한율·명단 투찰률)로 그날 하한·1등 자리·낙찰을 가리고, 어느 값이든 그
 * 눈금(금액 ÷ (기초금액 × 하한율))에 올려 판정과 추첨 평균 기대를 내는 복기 규칙을 소유한다.
 *
 * 판정은 정수 산술로 한다. 하한 위인지, 다른 업체의 가장 낮은 유효 투찰보다 낮은지는 소수점 반올림 하나로 뒤집힐 수 있어 화면에
 * 보이는 소수로 비교하지 않는다. 추첨 평균 기대만 예정가격 분포를 적분하는 근사라 부동소수다(맞춤 고르기와 같은 적분).
 */
import { cumulativeAt, type PlannedRatioDistribution } from "./market-position-pick";

export type ReviewVerdict = "below-floor" | "first" | "above-winner";

export interface ReviewRoundFacts {
  /** 원 단위 두 자리 문자열이다(`8255500.00`). */
  readonly baseAmount: string;
  readonly plannedAmount: string;
  /** 하한율 % 소수 셋째 자리다(`90.000`). */
  readonly floorRate: string;
  /** 다른 업체 투찰률(예정가격 대비 %, 소수 셋째 자리)이다. 우리 업체 투찰은 뺀다. */
  readonly competitorRates: readonly string[];
}

const RATIO_SCALE = 6;

function scaled(text: string, scale: number): bigint {
  const negative = text.startsWith("-");
  const [whole, fraction = ""] = (negative ? text.slice(1) : text).split(".");
  if (fraction.length > scale) throw new RangeError(`소수 자리가 ${scale}을 넘는다: ${text}`);
  const value = BigInt(whole! + fraction.padEnd(scale, "0"));
  return negative ? -value : value;
}

/** 반올림한 고정 소수 문자열이다. 음수는 다루지 않는다 — 비율은 늘 양수다. */
function divideRounded(numerator: bigint, denominator: bigint, scale: number): string {
  const factor = 10n ** BigInt(scale);
  const quotient = (numerator * factor * 2n + denominator) / (denominator * 2n);
  const whole = quotient / factor;
  return `${whole}.${(quotient % factor).toString().padStart(scale, "0")}`;
}

interface Scaled {
  readonly base: bigint;
  readonly planned: bigint;
  readonly floor: bigint;
}

function scaledFacts(facts: ReviewRoundFacts): Scaled {
  return { base: scaled(facts.baseAmount, 2), planned: scaled(facts.plannedAmount, 2), floor: scaled(facts.floorRate, 3) };
}

/** 그날 하한이다 — 예정가격 ÷ 기초금액. 이 눈금에서 이보다 낮은 값은 무효다. */
export function floorRatio(facts: ReviewRoundFacts): string {
  const { base, planned } = scaledFacts(facts);
  return divideRounded(planned, base, RATIO_SCALE);
}

/** 투찰률(예정가격 대비 %)을 복기 눈금으로 옮긴다: 투찰률 ÷ 하한율 × 예정가격 ÷ 기초금액. */
export function rateRatio(facts: ReviewRoundFacts, rate: string): string {
  const { base, planned, floor } = scaledFacts(facts);
  return divideRounded(scaled(rate, 3) * planned, floor * base, RATIO_SCALE);
}

/** 다른 업체의 가장 낮은 유효 투찰률이다. 유효는 투찰률 ≥ 하한율이다(예정가격 대비 축이라 나눗셈 없이 정확하다). */
export function bestCompetitorRate(facts: ReviewRoundFacts): string | null {
  const floor = scaled(facts.floorRate, 3);
  let best: string | null = null;
  for (const rate of facts.competitorRates) {
    const value = scaled(rate, 3);
    if (value < floor) continue;
    if (best === null || value < scaled(best, 3)) best = rate;
  }
  return best;
}

/** 우리 값(배율) 하나를 가린다. 유효는 배율 × 기초금액 ≥ 예정가격, 1등 자리는 배율 × 하한율 × 기초금액 < 최저 유효 투찰률 × 예정가격이다. */
export function classifyRatio(facts: ReviewRoundFacts, ratio: string): ReviewVerdict {
  const { base, planned, floor } = scaledFacts(facts);
  const value = scaled(ratio, RATIO_SCALE);
  const unit = 10n ** BigInt(RATIO_SCALE);
  if (value * base < planned * unit) return "below-floor";
  const best = bestCompetitorRate(facts);
  if (best === null) return "first";
  // 좌변 scale: 배율 1e6 · 하한율 1e3 · 기초 1e2, 우변: 투찰률 1e3 · 예정 1e2 · 1e6.
  return value * floor * base < scaled(best, 3) * planned * unit ? "first" : "above-winner";
}

/** 실제 낸 투찰률 하나를 가린다. 둘 다 예정가격 대비 축이라 그대로 비교한다. */
export function classifyRate(facts: ReviewRoundFacts, rate: string): ReviewVerdict {
  const value = scaled(rate, 3);
  if (value < scaled(facts.floorRate, 3)) return "below-floor";
  const best = bestCompetitorRate(facts);
  return best === null || value < scaled(best, 3) ? "first" : "above-winner";
}

/**
 * 값 몇 개를 함께 넣었을 때 하나라도 낙찰할 확률을 예정가격 추첨으로 평균한다. 값 x로 낙찰하는 것은 예정가격 비율이 (바로 아래
 * 경쟁 투찰, x] 안에 뽑힐 때이고, 둘째 값은 첫 값이 덮은 구간을 빼고 센다 — 맞춤을 고를 때와 같은 적분이다.
 */
export function expectedWins(
  facts: ReviewRoundFacts,
  ratios: readonly string[],
  distribution: PlannedRatioDistribution,
): number {
  const competitors = facts.competitorRates.map((rate) => Number(rateRatio(facts, rate))).sort((left, right) => left - right);
  const cdf = (value: number) => (value < 0 ? 0 : cumulativeAt(distribution, value));
  let total = 0;
  let previous = -1;
  for (const value of ratios.map(Number).sort((left, right) => left - right)) {
    if (value <= previous) continue;
    let below = -1;
    for (const competitor of competitors) {
      if (competitor < value) below = competitor;
      else break;
    }
    total += Math.max(0, cdf(value) - cdf(Math.max(below, previous)));
    previous = value;
  }
  return total;
}

/**
 * 기초금액 대비 %(소수 넷째 자리)를 복기 눈금으로 옮긴다: 기초금액 대비 % ÷ 하한율. 화면 장부와 낙찰 결정의 투찰률(기초금액 축)이
 * 이 길로 같은 눈금에 앉는다(ADR 0066).
 */
export function baseRelativeRatio(baseRelativeRate: string, floorRate: string): string {
  return divideRounded(scaled(baseRelativeRate, 4) * 1000n, scaled(floorRate, 3) * 10000n, RATIO_SCALE);
}
