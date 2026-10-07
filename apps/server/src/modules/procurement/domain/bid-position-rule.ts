/**
 * @module 책임: 추천 투찰가 규칙의 버전별 대역 표와, 기초금액·하한율·참여 수에서 원 단위 금액을 정확히 내는
 * 계산을 소유한다. 표가 바뀌면 버전이 바뀌고, 근거는 `docs/experiments/2026-10-07-bid-position-revalidation.md`
 * §11과 그 재현 스크립트(`tools/m1/revalidate-2026-10/position/ruletable.py`)다.
 */
import {
  baseRelativeBidRate,
  canonicalDecimal,
  krw,
  percentagePoints,
  type BaseRelativeBidRate,
  type BidRate,
  type CanonicalDecimal,
  type Money,
  type PercentagePoints,
} from "@eatbid/domain";

export type BidPositionBand = "40-69" | "70-plus";

export type BidPositionNotApplicableReason =
  | "floor-rate-unobserved"
  | "floor-rate-outside-rule"
  | "participation-unobserved"
  | "participation-below-rule";

export interface BidPosition {
  readonly order: number;
  readonly amount: Money;
  readonly baseRelativeRate: BaseRelativeBidRate;
  readonly cumulativeWinRate: PercentagePoints;
  readonly cumulativeLotteryWinRate: PercentagePoints;
  readonly cumulativeValidationWins: number;
}

export type BidPositionSelection = "training" | "validation-informed";

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
    readonly band: BidPositionBand;
    readonly selection: BidPositionSelection;
    readonly validationRounds: number;
    readonly holdout: BidPositionHoldout | null;
    readonly positions: readonly BidPosition[];
  }
  | { readonly state: "not-applicable"; readonly reason: BidPositionNotApplicableReason };

interface RulePosition {
  /** 하한 기준액(기초금액 × 낙찰하한율)에 곱하는 배수다. 소수 넷째 자리 문자열이며 Number로 계산하지 않는다. */
  readonly multiple: string;
  readonly cumulativeWinRate: string;
  readonly cumulativeLotteryWinRate: string;
  readonly cumulativeValidationWins: number;
}

interface RuleBand {
  readonly band: BidPositionBand;
  readonly minimumBidCount: number;
  readonly selection: BidPositionSelection;
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

/**
 * 2025-12까지로 고르고 2026-01~08 하한율 90 회차로 검증한 표다. 낙찰률은 1번부터 그 자리까지 함께 냈을 때의
 * 누적이고, 운 기준선은 같은 장수를 무작위 자리에 냈을 때의 기대값이다. 70곳 이상 3번 배수가 2번보다 낮은 것은
 * 오기가 아니라 앞 두 장이 덮지 못한 자리를 고른 결과다.
 *
 * 40~69곳의 1·2번 배수는 학습 상위 네 쌍(학습 배수 1.385~1.399) 가운데 검증 성적이 가장 좋은 쌍이라 검증 기간
 * 수치가 낙관적이다(`validation-informed`). 학습 1위 쌍(0.9860·0.9915)과 0.0005 차이라 격자 잡음 안이고, 고른 뒤
 * 처음 본 2026-09 운영 자료가 깨끗한 근거다(`holdout`, 실험 기록 §2-5). 70곳 이상은 학습 선택 그대로다.
 *
 * 하한율 90 밖과 참여 40곳 미만은 검증하지 않았다. 같은 배수를 거기 쓰면 운보다 나빠졌으므로(0.29배) 표에
 * 없는 조건은 숫자를 내지 않는다.
 */
export const BID_POSITION_RULE = {
  version: "2026-10-07",
  trainedThrough: "2025-12",
  validatedFrom: "2026-01",
  validatedThrough: "2026-08",
  floorRate: "90.000",
  bands: [
    {
      band: "70-plus",
      minimumBidCount: 70,
      selection: "training",
      validationRounds: 8004,
      holdout: null,
      positions: [
        { multiple: "0.9830", cumulativeWinRate: "1.411794", cumulativeLotteryWinRate: "0.882880", cumulativeValidationWins: 113 },
        { multiple: "0.9900", cumulativeWinRate: "2.573713", cumulativeLotteryWinRate: "1.765761", cumulativeValidationWins: 206 },
        { multiple: "0.9880", cumulativeWinRate: "3.635682", cumulativeLotteryWinRate: "2.648641", cumulativeValidationWins: 291 },
      ],
    },
    {
      band: "40-69",
      minimumBidCount: 40,
      selection: "validation-informed",
      validationRounds: 3450,
      holdout: { month: "2026-09", rounds: 869, tickets: 2, wins: 41, lotteryExpectedWins: "33.7" },
      positions: [
        { multiple: "0.9855", cumulativeWinRate: "2.260870", cumulativeLotteryWinRate: "1.787757", cumulativeValidationWins: 78 },
        { multiple: "0.9920", cumulativeWinRate: "4.318841", cumulativeLotteryWinRate: "3.575513", cumulativeValidationWins: 149 },
        { multiple: "0.9945", cumulativeWinRate: "5.971014", cumulativeLotteryWinRate: "5.363270", cumulativeValidationWins: 206 },
      ],
    },
  ] satisfies readonly RuleBand[],
} as const;

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
function positionAmount(baseAmount: Money, floorRate: BidRate, multiple: string): Money {
  const numerator = scaled(baseAmount.amount, 2) * scaled(floorRate, 3) * scaled(multiple, 4);
  const denominator = 10n ** 11n;
  const won = (numerator + denominator - 1n) / denominator;
  return krw(canonicalDecimal(`${won}.00`, 2));
}

/** 하한율(소수 셋째)×배수(소수 넷째)는 소수 일곱째까지 정확하고, 하한율 90.000에서는 넷째 아래가 항상 0이다. */
function positionBaseRelativeRate(floorRate: BidRate, multiple: string): BaseRelativeBidRate {
  const product = scaled(floorRate, 3) * scaled(multiple, 4);
  if (product % 1000n !== 0n) throw new RangeError("추천 투찰가 기초금액 대비율이 소수 넷째 자리에서 끝나지 않는다");
  return baseRelativeBidRate(canonicalDecimal(decimalText(product / 1000n, 4), 4));
}

export function positionBids(input: {
  readonly baseAmount: Money;
  readonly floorRate: BidRate | null;
  readonly bidCount: number | null;
}): BidPositionResult {
  if (input.floorRate === null) return { state: "not-applicable", reason: "floor-rate-unobserved" };
  if (input.floorRate !== BID_POSITION_RULE.floorRate) return { state: "not-applicable", reason: "floor-rate-outside-rule" };
  if (input.bidCount === null) return { state: "not-applicable", reason: "participation-unobserved" };
  const bidCount = input.bidCount;
  const band = BID_POSITION_RULE.bands.find((candidate) => bidCount >= candidate.minimumBidCount);
  if (band === undefined) return { state: "not-applicable", reason: "participation-below-rule" };
  const floorRate = input.floorRate;
  return {
    state: "applicable",
    band: band.band,
    selection: band.selection,
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
