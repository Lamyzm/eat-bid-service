import { describe, expect, test } from "bun:test";
import { bidRate, canonicalDecimal, krw } from "@eatbid/domain";
import { MARKET_PICK_FIXTURE } from "./__fixtures__/market-position-pick";
import {
  floorRelativeRatio,
  marketPositionBids,
  pickMarketMultiples,
  type MarketRound,
} from "./market-position-pick";
import { MARKET_POSITION_PICK } from "./market-position-pick-table";
import { PLANNED_RATIO_DISTRIBUTION } from "./planned-ratio-distribution-table";

const roundsOf = (rounds: readonly (readonly string[])[]): MarketRound[] =>
  rounds.map((ratios) => ({ competitorRatios: ratios.map((ratio) => floorRelativeRatio(canonicalDecimal(ratio, 8))) }));

const pick = (rounds: readonly MarketRound[], tickets: 1 | 2) => pickMarketMultiples({
  rounds,
  tickets,
  candidates: MARKET_POSITION_PICK.candidates,
  distribution: PLANNED_RATIO_DISTRIBUTION,
});

describe("최근 3개월 맞춤 배수 고르기", () => {
  test("분석 스크립트(numpy)와 같은 합성 공고에서 같은 한 장 배수를 고르고 기대 낙찰도 같다", () => {
    const result = pick(roundsOf(MARKET_PICK_FIXTURE.rounds), 1);
    expect(result.multiples).toEqual([...MARKET_PICK_FIXTURE.expected.oneTicket.multiples]);
    expect(result.inSampleExpectedWins).toBeCloseTo(MARKET_PICK_FIXTURE.expected.oneTicket.expectedWins, 6);
  });

  test("분석 스크립트(numpy)와 같은 합성 공고에서 같은 두 장 배수를 낮은 쪽부터 고른다", () => {
    const result = pick(roundsOf(MARKET_PICK_FIXTURE.rounds), 2);
    expect(result.multiples).toEqual([...MARKET_PICK_FIXTURE.expected.twoTickets.multiples]);
    expect(result.inSampleExpectedWins).toBeCloseTo(MARKET_PICK_FIXTURE.expected.twoTickets.expectedWins, 6);
  });

  test("아래에 경쟁 투찰이 없으면 예정가격이 그 금액 아래로 뽑히기만 하면 이기므로 가장 높은 후보를 고른다", () => {
    const result = pick(roundsOf([["1.01000000", "1.02000000"], ["1.00500000"]]), 1);
    expect(result.multiples).toEqual(["1.0040"]);
  });

  test("하한 기준 투찰 비율은 소수 여덟째 자리가 아니면 받지 않는다", () => {
    expect(() => floorRelativeRatio(canonicalDecimal("0.9850", 4))).toThrow(RangeError);
  });
});

describe("최근 3개월 맞춤 금액", () => {
  test("고른 배수를 전국 규칙과 같은 식으로 원 단위 금액과 기초금액 대비율로 바꾼다", () => {
    const result = marketPositionBids({
      baseAmount: krw(canonicalDecimal("10000000.00", 2)),
      floorRate: bidRate(canonicalDecimal("90.000", 3)),
      pick: { multiples: ["0.9850", "0.9890"], inSampleExpectedWins: 8.07 },
      single: { multiples: ["0.9849"], inSampleExpectedWins: 4.5 },
      marketRounds: 158,
      linkedBusinesses: 2,
    });
    if (result.state !== "applicable") throw new Error("적용 대상이어야 한다");
    // 10,000,000 × 0.9 × 0.9850 = 8,865,000, × 0.9890 = 8,901,000
    expect(result.positions.map((position) => position.amount.amount)).toEqual(["8865000.00", "8901000.00"]);
    expect(result.positions.map((position) => position.baseRelativeRate)).toEqual(["88.6500", "89.0100"]);
    // 한 장 금액은 두 장의 1번과 따로 고른다. 10,000,000 × 0.9 × 0.9849 = 8,864,100
    expect(result.single.amount.amount).toBe("8864100.00");
    expect(result.single.order).toBe(1);
  });

  test("원 단위 아래가 남으면 올림한다", () => {
    const result = marketPositionBids({
      baseAmount: krw(canonicalDecimal("9491620.00", 2)),
      floorRate: bidRate(canonicalDecimal("90.000", 3)),
      pick: { multiples: ["0.9845"], inSampleExpectedWins: 1 },
      single: { multiples: ["0.9845"], inSampleExpectedWins: 1 },
      marketRounds: 70,
      linkedBusinesses: 1,
    });
    if (result.state !== "applicable") throw new Error("적용 대상이어야 한다");
    // 9,491,620 × 0.9 × 0.9845 = 8,410,049.901 → 8,410,050
    expect(result.positions[0]!.amount.amount).toBe("8410050.00");
    expect(result.positions).toHaveLength(1);
  });
});
