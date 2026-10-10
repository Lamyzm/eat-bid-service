/**
 * @module 책임: 하한율·참여 수(마감 전 관측이면 마감 1시간 전으로 보정)로 규칙 표의 대역을 고르고, 기초금액에서 원 단위
 * 추천 금액을 정확히 내는 계산을 소유한다. 표 자체는 `bid-position-rule-table.ts`·`bid-position-growth-table.ts`가 소유한다.
 */
import {
  baseRelativeBidRate,
  canonicalDecimal,
  krw,
  percentagePoints,
  Temporal,
  type BaseRelativeBidRate,
  type BidRate,
  type CanonicalDecimal,
  type Money,
  type PercentagePoints,
} from "@eatbid/domain";

import { PARTICIPATION_GROWTH } from "./bid-position-growth-table";
import { BID_POSITION_RULE } from "./bid-position-rule-table";

export type BidPositionNotApplicableReason =
  | "floor-rate-unobserved"
  | "floor-rate-outside-rule"
  | "participation-unobserved"
  | "participation-below-rule";

export type BidPositionSelection = "training" | "validation-informed";
export type BidPositionEvidence = "clear" | "weak";

interface RulePosition {
  /** 하한 기준액(기초금액 × 낙찰하한율)에 곱하는 배수다. 소수 넷째 자리 문자열이며 Number로 계산하지 않는다. */
  readonly multiple: string;
  readonly cumulativeWinRate: string;
  readonly cumulativeLotteryWinRate: string;
  readonly cumulativeValidationWins: number;
}

interface RuleBand {
  readonly minBidCount: number;
  readonly maxBidCount: number | null;
  readonly evidence: BidPositionEvidence;
  readonly validationRounds: number;
  readonly holdout: {
    readonly month: string;
    readonly rounds: number;
    readonly tickets: number;
    readonly wins: number;
    readonly lotteryExpectedWins: string;
  } | null;
  readonly positions: readonly RulePosition[];
}

export interface BidPositionRuleTable {
  readonly version: string;
  readonly trainedThrough: string;
  readonly validatedFrom: string;
  readonly validatedThrough: string;
  readonly floors: readonly { readonly floorRate: string; readonly bands: readonly RuleBand[] }[];
}

export interface ParticipationGrowthTable {
  /** 마감까지 남은 시간 구간 `[fromHours, toHours)`이며 행 순서가 `ratioHundredths`의 행 순서다. */
  readonly hourBuckets: readonly { readonly fromHours: number; readonly toHours: number }[];
  /** 지금 관측한 참여 수 구간 `[fromBidCount, belowBidCount)`이며 칸 순서가 `ratioHundredths`의 열 순서다. */
  readonly countBuckets: readonly { readonly fromBidCount: number; readonly belowBidCount: number | null }[];
  readonly ratioHundredths: Readonly<Record<string, readonly (readonly number[])[]>>;
}

export interface BidPosition {
  readonly order: number;
  readonly amount: Money;
  readonly baseRelativeRate: BaseRelativeBidRate;
  readonly cumulativeWinRate: PercentagePoints;
  readonly cumulativeLotteryWinRate: PercentagePoints;
  readonly cumulativeValidationWins: number;
}

/**
 * 대역을 고른 참여 수의 출처다. 규칙은 마감 1시간 전 참여 수로 대역을 정의했으므로, 그보다 이른 관측은 보정표로
 * 옮긴 추정값으로 고르고 그 사실을 함께 낸다. 화면이 관측값과 추정값을 같은 숫자로 보이면 안 된다(AGENTS 3).
 */
export type BidCountBasis =
  | { readonly kind: "observed"; readonly bidCount: number }
  | {
    readonly kind: "estimated";
    readonly observedBidCount: number;
    readonly hoursBeforeDeadline: number;
    readonly estimatedBidCount: number;
  };

export interface BidPositionHoldout {
  readonly month: string;
  readonly rounds: number;
  readonly tickets: number;
  readonly wins: number;
  readonly lotteryExpectedWins: CanonicalDecimal;
}

export type BidPositionResult =
  | {
    readonly state: "applicable";
    readonly band: { readonly minBidCount: number; readonly maxBidCount: number | null };
    readonly bidCountBasis: BidCountBasis;
    readonly evidence: BidPositionEvidence;
    readonly selection: BidPositionSelection;
    readonly validationRounds: number;
    readonly holdout: BidPositionHoldout | null;
    readonly positions: readonly BidPosition[];
  }
  | { readonly state: "not-applicable"; readonly reasons: readonly BidPositionNotApplicableReason[] };

/** 소수점을 떼어 정수 계수로 만든다. 자리수는 호출자가 아는 고정 scale이라 여기서 맞춘다. */
function scaled(text: string, scale: number): bigint {
  const [integer, fraction = ""] = text.split(".");
  return BigInt(`${integer}${fraction.padEnd(scale, "0")}`);
}

function decimalText(coefficient: bigint, scale: number): string {
  const digits = coefficient.toString().padStart(scale + 1, "0");
  return `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
}

/**
 * 금액 = 기초금액 × 낙찰하한율 × 배수, 원 단위 올림이다. 분모를 기초금액 하나로 착각하면 약 10% 틀리므로
 * (재검증 중 실제로 있었던 일) 하한 기준액을 거쳐 계산한다. 정수 계수만 곱하므로 반올림은 마지막 한 번뿐이다.
 * 올림인 이유는 배수가 가리키는 자리보다 낮게 내지 않기 위해서다 — 1원 차이가 낙찰 순서를 바꾸지는 않는다.
 */
export function positionAmount(baseAmount: Money, floorRate: BidRate, multiple: string): Money {
  const numerator = scaled(baseAmount.amount, 2) * scaled(floorRate, 3) * scaled(multiple, 4);
  const denominator = 10n ** 11n;
  const won = (numerator + denominator - 1n) / denominator;
  return krw(canonicalDecimal(`${won}.00`, 2));
}

/** 하한율(소수 셋째)×배수(소수 넷째)는 소수 일곱째까지 정확하고, 표의 하한율(90.000·88.000)에서는 넷째 아래가 항상 0이다. */
export function positionBaseRelativeRate(floorRate: BidRate, multiple: string): BaseRelativeBidRate {
  const product = scaled(floorRate, 3) * scaled(multiple, 4);
  if (product % 1000n !== 0n) throw new RangeError("추천 투찰가 기초금액 대비율이 소수 넷째 자리에서 끝나지 않는다");
  return baseRelativeBidRate(canonicalDecimal(decimalText(product / 1000n, 4), 4));
}

function within(value: number, low: number, high: number | null): boolean {
  return value >= low && (high === null || value <= high);
}

/**
 * 관측이 마감 1시간 전보다 이르면 보정표의 배율로 마감 1시간 전 참여 수를 추정한다. 마감을 모르거나 관측이 마감
 * 1시간 전 이후면 관측값을 그대로 쓴다. 48시간보다 이르면 마지막 줄을 쓴다. 0곳은 배율을 곱해도 0이라 그대로다.
 */
export function bidCountBasisOf(input: {
  readonly floorRate: string;
  readonly bidCount: number;
  readonly observedAt: Temporal.Instant;
  readonly deadlineAt: Temporal.Instant | null;
}): BidCountBasis {
  const observed: BidCountBasis = { kind: "observed", bidCount: input.bidCount };
  // 표 리터럴 타입을 넓혀 하한율 문자열로 찾는다. 표에 없는 하한율이면 보정하지 않는다.
  const table: ParticipationGrowthTable = PARTICIPATION_GROWTH;
  const rows = table.ratioHundredths[input.floorRate];
  if (input.deadlineAt === null || rows === undefined || input.bidCount === 0) return observed;
  const hours = input.observedAt.until(input.deadlineAt, { largestUnit: "hour" }).total({ unit: "hour" });
  // 규칙의 대역은 마감 1시간 전 참여 수로 정의했다. 그 시점이나 그 뒤의 관측은 그대로 쓴다.
  if (hours <= 1) return observed;
  const hourIndex = table.hourBuckets.findIndex((bucket) => hours < bucket.toHours);
  const row = rows[hourIndex === -1 ? rows.length - 1 : hourIndex]!;
  const countIndex = table.countBuckets.findIndex((bucket) =>
    input.bidCount >= bucket.fromBidCount && (bucket.belowBidCount === null || input.bidCount < bucket.belowBidCount));
  const ratio = row[countIndex] ?? 100;
  // 정수 백분의 일 배율이라 반올림을 정수 연산으로 한다(+50 후 내림).
  const estimated = Math.floor((input.bidCount * ratio + 50) / 100);
  return {
    kind: "estimated",
    observedBidCount: input.bidCount,
    hoursBeforeDeadline: Math.floor(hours),
    estimatedBidCount: estimated,
  };
}

export function positionBids(input: {
  readonly baseAmount: Money;
  readonly floorRate: BidRate | null;
  readonly participation: { readonly bidCount: number; readonly observedAt: Temporal.Instant } | null;
  readonly deadlineAt: Temporal.Instant | null;
}): BidPositionResult {
  const reasons: BidPositionNotApplicableReason[] = [];
  const floor = input.floorRate === null
    ? undefined
    : BID_POSITION_RULE.floors.find((candidate) => candidate.floorRate === input.floorRate);
  if (input.floorRate === null) reasons.push("floor-rate-unobserved");
  else if (floor === undefined) reasons.push("floor-rate-outside-rule");
  if (input.participation === null) reasons.push("participation-unobserved");
  if (floor === undefined || input.participation === null || input.floorRate === null) {
    return { state: "not-applicable", reasons };
  }
  const basis = bidCountBasisOf({
    floorRate: floor.floorRate,
    bidCount: input.participation.bidCount,
    observedAt: input.participation.observedAt,
    deadlineAt: input.deadlineAt,
  });
  const count = basis.kind === "observed" ? basis.bidCount : basis.estimatedBidCount;
  const band = floor.bands.find((candidate) => within(count, candidate.minBidCount, candidate.maxBidCount));
  if (band === undefined) return { state: "not-applicable", reasons: ["participation-below-rule"] };
  const floorRate = input.floorRate;
  return {
    state: "applicable",
    band: { minBidCount: band.minBidCount, maxBidCount: band.maxBidCount },
    bidCountBasis: basis,
    evidence: band.evidence,
    // 2026-10-10판은 모든 대역을 검증 기간을 보지 않는 절차로 골랐다(실험 기록 §12·§13).
    selection: "training",
    validationRounds: band.validationRounds,
    holdout: band.holdout === null ? null : {
      ...band.holdout,
      lotteryExpectedWins: canonicalDecimal(band.holdout.lotteryExpectedWins, 1),
    },
    positions: band.positions.map((position, index) => ({
      order: index + 1,
      amount: positionAmount(input.baseAmount, floorRate, position.multiple),
      baseRelativeRate: positionBaseRelativeRate(floorRate, position.multiple),
      cumulativeWinRate: percentagePoints(canonicalDecimal(position.cumulativeWinRate, 6)),
      cumulativeLotteryWinRate: percentagePoints(canonicalDecimal(position.cumulativeLotteryWinRate, 6)),
      cumulativeValidationWins: position.cumulativeValidationWins,
    })),
  };
}

export { BID_POSITION_RULE };
