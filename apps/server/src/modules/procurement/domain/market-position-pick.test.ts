import { describe, expect, test } from "bun:test";
import { bidRate, canonicalDecimal, krw } from "@eatbid/domain";
import { MARKET_PICK_FIXTURE } from "./__fixtures__/market-position-pick";
import {
  floorRelativeRatio,
  marketPositionBids,
  pickMarketMultiples,
  spareMarketMultiples,
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

const tenThousandths = (multiple: string) => Math.round(Number(multiple) * 10000);

describe("예비 순위 배수", () => {
  test("한 장 기대가 큰 순으로 고르되 이미 고른 배수와 서로에게서 0.0005 이상 떨어진 자리만 고른다", () => {
    const rounds = roundsOf(MARKET_PICK_FIXTURE.rounds);
    const taken = [...MARKET_PICK_FIXTURE.expected.twoTickets.multiples, ...MARKET_PICK_FIXTURE.expected.oneTicket.multiples];
    const spares = spareMarketMultiples({
      rounds, candidates: MARKET_POSITION_PICK.candidates, distribution: PLANNED_RATIO_DISTRIBUTION,
      taken, count: 3, minimumGapTenThousandths: 5,
    });
    expect(spares).toHaveLength(3);
    const all = [...taken, ...spares].map(tenThousandths);
    for (const spare of spares) {
      const own = tenThousandths(spare);
      expect(all.filter((other) => other !== own).every((other) => Math.abs(other - own) >= 5)).toBe(true);
    }
  });

  test("한 장으로 고른 최선 배수보다 한 장 기대가 큰 예비는 없고, 예비끼리는 기대가 큰 순이다", () => {
    const rounds = roundsOf(MARKET_PICK_FIXTURE.rounds);
    const best = pick(rounds, 1);
    const spares = spareMarketMultiples({
      rounds, candidates: MARKET_POSITION_PICK.candidates, distribution: PLANNED_RATIO_DISTRIBUTION,
      taken: best.multiples, count: 3, minimumGapTenThousandths: 5,
    });
    const scoreOf = (multiple: string) => pickMarketMultiples({
      rounds, tickets: 1, distribution: PLANNED_RATIO_DISTRIBUTION,
      candidates: { fromTenThousandths: tenThousandths(multiple), toTenThousandths: tenThousandths(multiple), stepTenThousandths: 1 },
    }).inSampleExpectedWins;
    const scores = spares.map(scoreOf);
    for (const score of scores) expect(score).toBeLessThanOrEqual(best.inSampleExpectedWins);
    expect([...scores].sort((left, right) => right - left)).toEqual(scores);
  });

  test("격자가 좁아 조건을 만족하는 자리가 모자라면 있는 만큼만 낸다", () => {
    const spares = spareMarketMultiples({
      rounds: roundsOf([["0.99000000"]]),
      candidates: { fromTenThousandths: 9900, toTenThousandths: 9908, stepTenThousandths: 1 },
      distribution: PLANNED_RATIO_DISTRIBUTION, taken: ["0.9904"], count: 3, minimumGapTenThousandths: 5,
    });
    // 9900~9908에서 9904와 5칸 이상 떨어진 자리는 없다(9899·9909는 격자 밖).
    expect(spares).toEqual([]);
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
