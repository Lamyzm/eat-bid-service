import { describe, expect, test } from "bun:test";
import { bidRate, canonicalDecimal, krw, Temporal } from "@eatbid/domain";
import { bidCountBasisOf, positionBids } from "./bid-position-rule";

const base = krw(canonicalDecimal("17159500.00", 2));
const floor90 = bidRate(canonicalDecimal("90.000", 3));
const floor88 = bidRate(canonicalDecimal("88.000", 3));
const deadline = Temporal.Instant.from("2026-10-07T02:00:00Z");
const nearDeadline = Temporal.Instant.from("2026-10-07T01:00:00Z");
const observed = (bidCount: number, at = nearDeadline) => ({ bidCount, observedAt: at });

describe("추천 투찰가 규칙 2026-10-10", () => {
  test("하한율 90·참여 40~69곳이면 하한 기준액에 배수를 곱해 원 단위로 올림한다", () => {
    const result = positionBids({ baseAmount: base, floorRate: floor90, participation: observed(52), deadlineAt: deadline });
    if (result.state !== "applicable") throw new Error("적용 대상이어야 한다");
    expect(result.band).toEqual({ minBidCount: 40, maxBidCount: 69 });
    expect(result.bidCountBasis).toEqual({ kind: "observed", bidCount: 52 });
    expect(result.selection).toBe("training");
    // 17,159,500 × 0.9 × 0.9860 = 15,227,340.3 → 올림
    expect(result.positions[0]!.amount.amount).toBe("15227341.00");
    expect(result.positions[0]!.baseRelativeRate).toBe("88.7400");
    expect(result.holdout?.month).toBe("2026-09");
  });

  test("하한율 88 회차도 자기 표로 계산하고 대비율은 하한율 88을 곱한다", () => {
    const result = positionBids({ baseAmount: base, floorRate: floor88, participation: observed(14), deadlineAt: deadline });
    if (result.state !== "applicable") throw new Error("적용 대상이어야 한다");
    expect(result.band).toEqual({ minBidCount: 10, maxBidCount: 19 });
    expect(result.positions[0]!.baseRelativeRate).toBe("87.6480");
  });

  test("대역 경계 1·2·9·10·39·40·69·70곳을 정확히 나눈다", () => {
    const bandOf = (bidCount: number) => {
      const result = positionBids({ baseAmount: base, floorRate: floor90, participation: observed(bidCount), deadlineAt: deadline });
      return result.state === "applicable" ? `${result.band.minBidCount}-${result.band.maxBidCount ?? ""}` : result.reasons.join(",");
    };
    expect([1, 2, 9, 10, 39, 40, 69, 70].map(bandOf))
      .toEqual(["participation-below-rule", "2-9", "2-9", "10-19", "30-39", "40-69", "40-69", "70-"]);
  });

  test("마감 12시간 전 관측은 보정표로 마감 1시간 전 참여 수를 추정해 대역을 고른다", () => {
    const early = Temporal.Instant.from("2026-10-06T14:00:00Z");
    const result = positionBids({ baseAmount: base, floorRate: floor90, participation: observed(36, early), deadlineAt: deadline });
    if (result.state !== "applicable") throw new Error("적용 대상이어야 한다");
    // 12~15시간 줄 · 30~40곳 칸 배율 1.36 → 36 × 1.36 = 48.96 → 49곳
    expect(result.bidCountBasis).toEqual({ kind: "estimated", observedBidCount: 36, hoursBeforeDeadline: 12, estimatedBidCount: 49 });
    expect(result.band).toEqual({ minBidCount: 40, maxBidCount: 69 });
  });

  test("48시간보다 이른 관측은 마지막 줄을 쓰고 1시간 이내·마감 뒤·마감 미상은 관측값을 그대로 쓴다", () => {
    const veryEarly = bidCountBasisOf({ floorRate: "90.000", bidCount: 10, observedAt: Temporal.Instant.from("2026-10-03T02:00:00Z"), deadlineAt: deadline });
    expect(veryEarly).toEqual({ kind: "estimated", observedBidCount: 10, hoursBeforeDeadline: 96, estimatedBidCount: 60 });
    for (const [at, end] of [
      [Temporal.Instant.from("2026-10-07T01:30:00Z"), deadline],
      [Temporal.Instant.from("2026-10-07T03:00:00Z"), deadline],
      [nearDeadline, null],
    ] as const) {
      expect(bidCountBasisOf({ floorRate: "90.000", bidCount: 30, observedAt: at, deadlineAt: end })).toEqual({ kind: "observed", bidCount: 30 });
    }
  });

  test("하한율이 표 밖이거나 관측이 없으면 금액 없이 실패한 조건을 모두 낸다", () => {
    expect(positionBids({ baseAmount: base, floorRate: null, participation: null, deadlineAt: deadline }))
      .toEqual({ state: "not-applicable", reasons: ["floor-rate-unobserved", "participation-unobserved"] });
    expect(positionBids({ baseAmount: base, floorRate: bidRate(canonicalDecimal("82.995", 3)), participation: observed(24), deadlineAt: deadline }))
      .toEqual({ state: "not-applicable", reasons: ["floor-rate-outside-rule"] });
    expect(positionBids({ baseAmount: base, floorRate: floor90, participation: null, deadlineAt: deadline }))
      .toEqual({ state: "not-applicable", reasons: ["participation-unobserved"] });
  });

  test("근거가 약한 대역은 그 표시를 함께 낸다", () => {
    const result = positionBids({ baseAmount: base, floorRate: floor88, participation: observed(50), deadlineAt: deadline });
    if (result.state !== "applicable") throw new Error("적용 대상이어야 한다");
    expect(result.evidence).toBe("weak");
  });

  test("큰 기초금액도 Number 정밀도 손실 없이 계산한다", () => {
    const huge = krw(canonicalDecimal("9007199254740993.00", 2));
    const result = positionBids({ baseAmount: huge, floorRate: floor90, participation: observed(52), deadlineAt: deadline });
    if (result.state !== "applicable") throw new Error("적용 대상이어야 한다");
    // 9007199254740993 × 0.9 × 0.9860 = 7992988618657157.18... → 올림
    expect(result.positions[0]!.amount.amount).toBe("7992988618657158.00");
  });
});
