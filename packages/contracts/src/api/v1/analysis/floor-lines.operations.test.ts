import { describe, expect, test } from "bun:test";

import { publicHttpOperationRegistry } from "../../registry";
import { floorLinesV1ResponseSchema } from "./find-floor-lines.response";
import { floorLineV1Operations } from "./floor-lines.operations";

const 기본질의 = {
  from: "2025-10-01",
  to: "2026-09-30",
  floorRate: "90.000",
  regionScheme: "eat:auction-location-sigungu",
  regionCodeValueId: "459",
} as const;

function 통과하나(query: Record<string, unknown>): boolean {
  return floorLineV1Operations.findFloorLines.querySchema.safeParse(query).success;
}

const 하한선 = (value: string) => ({ value, unit: "percentage-points" as const });

describe("하한선 자리 operation 계약", () => {
  test("공개 registry가 두 operation을 한 번씩 갖고 같은 analysis resource에 산다", () => {
    for (const id of ["findFloorLines", "findFloorLineRegions"]) {
      const found = publicHttpOperationRegistry.filter((operation) => operation.operationId === id);
      expect(found).toHaveLength(1);
      expect(found[0]!.method).toBe("get");
      expect(found[0]!.route.resource).toBe("analysis");
    }
  });

  test("지역은 공고지역 시군구 체계와 코드값을 함께 받고 시도·참가제한지역 체계는 받지 않는다", () => {
    expect(통과하나(기본질의)).toBe(true);
    // 시도 전체는 수만 점이라 점으로 보내지 않는다(PDR-0009·PDR-0006).
    expect(통과하나({ ...기본질의, regionScheme: "eat:auction-location-sido" })).toBe(false);
    // 참가제한지역은 같은 숫자 모양이어도 이 화면의 지역이 아니다(AGENTS 6).
    expect(통과하나({ ...기본질의, regionScheme: "eat:eligibility-area" })).toBe(false);
    expect(통과하나({ ...기본질의, regionCodeValueId: undefined })).toBe(false);
  });

  test("1~10등 사다리는 include=ranks일 때만 청할 수 있다", () => {
    expect(통과하나({ ...기본질의, include: "ranks" })).toBe(true);
    expect(통과하나({ ...기본질의, include: "bids" })).toBe(false);
  });

  test("기간은 역전될 수 없고 3년 남짓의 상한을 넘을 수 없다", () => {
    expect(통과하나({ ...기본질의, from: "2026-09-30", to: "2026-09-01" })).toBe(false);
    expect(통과하나({ ...기본질의, from: "2024-01-01", to: "2026-10-14" })).toBe(true);
    expect(통과하나({ ...기본질의, from: "2023-01-01", to: "2026-10-14" })).toBe(false);
    // 지역 목록도 같은 기간 규칙을 쓴다.
    expect(floorLineV1Operations.findRegions.querySchema.safeParse({ from: "2023-01-01", to: "2026-10-14", floorRate: "90.000" }).success)
      .toBe(false);
  });

  test("응답은 사다리를 묻지 않았을 때 빈 배열이 아니라 null로 말하고 단위와 분모를 목록에 한 번 둔다", () => {
    const 응답 = {
      points: [{
        attemptId: "11",
        revisionId: "12",
        openedAt: "2026-09-28T02:00:00Z",
        organizationName: null,
        baseAmount: { amount: "9386500.00", currency: "KRW" },
        floor: 하한선("89.4437"),
      }],
      ladders: null,
      rule: {
        version: "2026-10-10",
        sourceRounds: 108126,
        quantiles: { unit: "percentage-points", denominator: "base-amount", values: ["89.4200", "89.9100", "90.3900"] },
      },
      meta: {
        build: { buildId: null, sourceReleaseId: null, calcVersion: null, computedAt: null, coverage: null, regionScheme: null },
        region: { codeValueId: "459", label: "김해시" },
        period: { from: "2025-10-01", to: "2026-09-30" },
        floorRate: { value: "90.000", unit: "percentage-points" },
        pointCount: 1,
      },
    };
    const parsed = floorLinesV1ResponseSchema.safeParse(응답);
    if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues));
    // 예정가격 대비 투찰률과 섞이지 않도록 분모를 이름으로 못 박는다.
    expect(floorLinesV1ResponseSchema.safeParse({
      ...응답,
      rule: { ...응답.rule, quantiles: { ...응답.rule.quantiles, denominator: "planned-amount" } },
    }).success).toBe(false);
  });
});
