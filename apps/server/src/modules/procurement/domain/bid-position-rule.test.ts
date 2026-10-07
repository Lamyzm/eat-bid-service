import { describe, expect, test } from "bun:test";
import { bidRate, canonicalDecimal, krw } from "@eatbid/domain";
import { positionBids } from "./bid-position-rule";

const base = krw(canonicalDecimal("17159500.00", 2));
const floor90 = bidRate(canonicalDecimal("90.000", 3));

describe("추천 투찰가 규칙", () => {
  test("참여 40~69곳이면 하한 기준액에 배수를 곱해 원 단위로 올림한다", () => {
    const result = positionBids({ baseAmount: base, floorRate: floor90, bidCount: 52 });
    if (result.state !== "applicable") throw new Error("적용 대상이어야 한다");
    expect(result.band).toBe("40-69");
    expect(result.validationRounds).toBe(3450);
    // 실험 기록 §2-1의 예: 기준액 15,443,550원 → 15,219,619원 / 15,320,002원
    expect(result.positions.map((position) => position.amount.amount))
      .toEqual(["15219619.00", "15320002.00", "15358611.00"]);
    expect(result.positions[0]!.baseRelativeRate).toBe("88.6950");
    expect(result.positions[1]!.cumulativeWinRate).toBe("4.318841");
    expect(result.positions[1]!.cumulativeLotteryWinRate).toBe("3.575513");
  });

  test("참여 70곳 이상은 다른 배수 표를 쓴다", () => {
    const result = positionBids({ baseAmount: base, floorRate: floor90, bidCount: 70 });
    if (result.state !== "applicable") throw new Error("적용 대상이어야 한다");
    expect(result.band).toBe("70-plus");
    expect(result.positions.map((position) => position.baseRelativeRate)).toEqual(["88.4700", "89.1000", "88.9200"]);
  });

  test("경계값 39·40·69·70곳을 대역에 정확히 나눈다", () => {
    const bandOf = (bidCount: number) => {
      const result = positionBids({ baseAmount: base, floorRate: floor90, bidCount });
      return result.state === "applicable" ? result.band : result.reason;
    };
    expect([39, 40, 69, 70].map(bandOf)).toEqual(["participation-below-rule", "40-69", "40-69", "70-plus"]);
  });

  test("하한율이 없거나 90이 아니거나 참여 수를 모르면 금액을 내지 않는다", () => {
    expect(positionBids({ baseAmount: base, floorRate: null, bidCount: 52 }))
      .toEqual({ state: "not-applicable", reason: "floor-rate-unobserved" });
    expect(positionBids({ baseAmount: base, floorRate: bidRate(canonicalDecimal("87.745", 3)), bidCount: 52 }))
      .toEqual({ state: "not-applicable", reason: "floor-rate-outside-rule" });
    expect(positionBids({ baseAmount: base, floorRate: floor90, bidCount: null }))
      .toEqual({ state: "not-applicable", reason: "participation-unobserved" });
  });

  test("큰 기초금액도 Number 정밀도 손실 없이 계산한다", () => {
    const huge = krw(canonicalDecimal("9007199254740993.00", 2));
    const result = positionBids({ baseAmount: huge, floorRate: floor90, bidCount: 52 });
    if (result.state !== "applicable") throw new Error("적용 대상이어야 한다");
    // 9007199254740993 × 0.9 × 0.9855 = 7988935378992523.74... → 올림
    expect(result.positions[0]!.amount.amount).toBe("7988935378992524.00");
  });
});
