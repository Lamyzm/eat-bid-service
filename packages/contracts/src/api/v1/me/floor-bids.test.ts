import { describe, expect, test } from "bun:test";

import { publicHttpOperationRegistry } from "../../registry";
import { myFloorBidsV1ResponseSchema, myFloorRegionV1ResponseSchema } from "./floor-bids.response";
import { myFloorBidV1Operations } from "./floor-bids.operations";

const 창 = {
  from: "2025-10-01",
  to: "2026-09-30",
  floorRate: "90.000",
  regionScheme: "eat:auction-location-sigungu",
  regionCodeValueId: "459",
} as const;

const meta = {
  region: { codeValueId: "459", label: "김해시" },
  period: { from: "2025-10-01", to: "2026-09-30" },
  floorRate: { value: "90.000", unit: "percentage-points" },
  linkedBusinessCount: 2,
  unlinkedBusinessCount: 0,
} as const;

const 투찰 = (outcome: unknown) => ({
  attemptId: "11",
  supplier: { supplierPartyId: "1947", name: "가상축산" },
  rate: { value: "90.3200", unit: "percentage-points" },
  outcome,
});

describe("내 사업자 하한선 자리 투찰 operation 계약", () => {
  test("공개 registry의 me resource에 한 번 있다", () => {
    const found = publicHttpOperationRegistry.filter((operation) => operation.operationId === "findMyFloorBids");
    expect(found).toHaveLength(1);
    expect(found[0]!.route.resource).toBe("me");
  });

  test("시장 조회와 같은 창을 받고 사다리 요청 같은 다른 조건은 받지 않는다", () => {
    const schema = myFloorBidV1Operations.findMyFloorBids.querySchema;
    expect(schema.safeParse(창).success).toBe(true);
    expect(schema.safeParse({ ...창, include: "ranks" }).success).toBe(false);
    expect(schema.safeParse({ ...창, regionScheme: "eat:auction-location-sido" }).success).toBe(false);
    expect(schema.safeParse({ ...창, from: "2023-01-01", to: "2026-10-14" }).success).toBe(false);
  });

  test("하한 미달은 등수가 없고 하한 위는 등수·하한 위 업체 수·낙찰 여부를 갖는다", () => {
    const parse = (outcome: unknown) => myFloorBidsV1ResponseSchema.safeParse({ bids: [투찰(outcome)], meta }).success;
    expect(parse({ kind: "below-floor" })).toBe(true);
    expect(parse({ kind: "below-floor", rank: 3 })).toBe(false);
    expect(parse({ kind: "valid", rank: 31, validBidderCount: 53, won: false })).toBe(true);
    expect(parse({ kind: "valid", rank: 0, validBidderCount: 53, won: false })).toBe(false);
  });
});

describe("내 업체 주 공고지역 operation 계약", () => {
  test("공개 registry의 me resource에 한 번 있고 지역 없이 기간·하한율만 받는다", () => {
    const found = publicHttpOperationRegistry.filter((operation) => operation.operationId === "findMyFloorRegion");
    expect(found).toHaveLength(1);
    expect(found[0]!.route.resource).toBe("me");
    const schema = myFloorBidV1Operations.findMyFloorRegion.querySchema;
    expect(schema.safeParse({ from: 창.from, to: 창.to, floorRate: 창.floorRate }).success).toBe(true);
    // 지역을 찾는 조회라 지역을 받으면 안 된다. 받으면 화면이 고른 지역을 되돌려 받는 것처럼 읽힌다.
    expect(schema.safeParse(창).success).toBe(false);
    expect(schema.safeParse({ from: "2023-01-01", to: "2026-10-14", floorRate: "90.000" }).success).toBe(false);
  });

  test("지역은 시도·시군구·회차 수를 함께 싣고, 없을 때는 null로 말한다", () => {
    const regionMeta = { period: meta.period, floorRate: meta.floorRate, linkedBusinessCount: 2, unlinkedBusinessCount: 0 };
    const region = {
      sido: { codeValueId: "40", label: "경남" },
      sigungu: { codeValueId: "459", label: "김해시" },
      roundCount: 1210,
    };
    expect(myFloorRegionV1ResponseSchema.safeParse({ region, meta: regionMeta }).success).toBe(true);
    expect(myFloorRegionV1ResponseSchema.safeParse({ region: null, meta: { ...regionMeta, linkedBusinessCount: 0 } }).success).toBe(true);
    expect(myFloorRegionV1ResponseSchema.safeParse({ region: { ...region, sigungu: undefined }, meta: regionMeta }).success).toBe(false);
  });
});
