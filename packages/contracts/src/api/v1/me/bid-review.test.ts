import { describe, expect, test } from "bun:test";

import { myBidReviewQuerySchema, myBidReviewV1Operations } from "./bid-review.operations";
import { myBidReviewV1ResponseSchema } from "./bid-review.response";

const ratio = (value: string) => ({ value, unit: "ratio" as const });

const response = {
  asOf: "2026-10-14T00:00:00Z",
  months: [{ month: "2026-09", rounds: 75, bids: 146, wins: 0 }],
  selected: {
    month: "2026-09",
    marketPick: { version: "2026-10-10", window: { fromMonth: "2026-06", throughMonth: "2026-08" }, ratios: [ratio("0.984900"), ratio("0.989400")], marketRounds: 164 },
    nationalRuleVersion: "2026-10-10",
    plannedDistribution: { version: "2026-10-10", sourceRounds: 108126 },
    unplannedRounds: 0,
    summaries: [{ method: "market-pick", rounds: 73, first: 5, allBelowFloor: 62, allAboveFirst: 2, expectedWins: "3.4", recomputedRounds: 73 }],
    rounds: [{
      auctionId: "120042",
      openedAt: "2026-09-16T01:00:00Z",
      displayBidNo: "E260909-658847-0",
      title: "2026년 10월 진영대창초등학교 급식용 식재료 축산물 소액수의 견적제출 공고",
      organizationLabel: "진영대창초등학교",
      itemLabel: "육류",
      baseAmount: { amount: "8255500.00", currency: "KRW" },
      floorRate: { value: "90.000", unit: "percentage-points" },
      bidderCount: 64,
      floorRatio: ratio("1.009115"),
      bestCompetitorRatio: ratio("1.009440"),
      winner: { label: "업체 가", ratio: ratio("1.009440"), mine: false },
      own: [{ label: "내 업체 1", ratio: ratio("0.997914"), verdict: "below-floor" }],
      ownExpectedWins: "0.0787",
      methods: [{ method: "market-pick", source: "recomputed", version: "2026-10-10", positions: [{ ratio: ratio("0.984900"), verdict: "below-floor" }], expectedWins: "0.0589" }],
    }],
  },
};

describe("내 투찰 복기 계약", () => {
  test("한 달 응답은 달 목록·맞춤 판·방법별 요약·공고별 대조를 같은 눈금(기초금액 대비 배율)으로 싣는다", () => {
    expect(myBidReviewV1ResponseSchema.parse(response).selected?.rounds[0]?.floorRatio.value).toBe("1.009115");
  });

  test("방법 값의 출처는 장부와 다시 계산 둘뿐이고, 판정은 하한 미달·1등 자리·1등 자리보다 높음뿐이다", () => {
    const methods = response.selected.rounds[0]!.methods;
    expect(() => myBidReviewV1ResponseSchema.parse({
      ...response,
      selected: { ...response.selected, rounds: [{ ...response.selected.rounds[0]!, methods: [{ ...methods[0]!, source: "guessed" }] }] },
    })).toThrow();
    expect(() => myBidReviewV1ResponseSchema.parse({
      ...response,
      selected: { ...response.selected, rounds: [{ ...response.selected.rounds[0]!, methods: [{ ...methods[0]!, positions: [{ ratio: ratio("0.984900"), verdict: "won" }] }] }] },
    })).toThrow();
  });

  test("내 공고가 없으면 고른 달이 null이고, 달은 KST 달 문자열로만 받는다", () => {
    expect(myBidReviewV1ResponseSchema.parse({ asOf: "2026-10-14T00:00:00Z", months: [], selected: null }).selected).toBeNull();
    expect(myBidReviewQuerySchema.parse({ month: "2026-09" })).toEqual({ month: "2026-09" });
    expect(() => myBidReviewQuerySchema.parse({ month: "2026-9" })).toThrow();
    expect(myBidReviewV1Operations.getMyBidReview.operationId).toBe("getMyBidReview");
  });
});
