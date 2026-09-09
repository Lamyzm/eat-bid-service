import { describe, expect, test } from "bun:test";
import { z } from "zod";

import { winRateDistributionV1ResponseSchema } from "./find-win-rate-distribution.response";
import { winRateDistributionQuerySchema, winRateDistributionV1Operations } from "./operations";

const operation = winRateDistributionV1Operations.find;

const nationalCohort = {
  scope: "national",
  floorRate: "90.000",
  awardMethod: "31",
} as const;

const bin = (from: string, to: string, count: number) => ({
  from: { value: from, unit: "percentage-points" },
  to: { value: to, unit: "percentage-points" },
  count,
});

const emptyMeta = {
  sampleCount: 0,
  item: null,
  scope: "national",
  regionCodeValueId: null,
  organizationId: null,
  floorRate: { value: "90.000", unit: "percentage-points" },
  awardMethod: "31",
  binWidth: { value: "0.010", unit: "percentage-points" },
  period: { from: "2025-10", to: "2026-09" },
  buildId: null,
  sourceReleaseId: null,
  calcVersion: null,
  computedAt: null,
  coverage: null,
  regionScheme: null,
} as const;

describe("낙찰률 분포 조회 operation 계약", () => {
  test("semantic route에서 canonical 경로와 사전순 query 문자열을 만든다", () => {
    expect(operation.operationId).toBe("findWinRateDistribution");
    expect(operation.path).toBe("/api/v1/win-rate-distribution");
    expect(operation.buildPath({ path: {}, query: nationalCohort })).toBe(
      "/api/v1/win-rate-distribution?awardMethod=31&binWidth=0.010&floorRate=90.000&granularity=total&scope=national",
    );
  });

  test("모집단과 축의 짝 네 조합을 받고 어긋난 조합을 거부한다", () => {
    const accepted = [
      nationalCohort,
      { ...nationalCohort, scope: "province", regionCodeValueId: "41" },
      { ...nationalCohort, scope: "district", regionCodeValueId: "43" },
      { ...nationalCohort, scope: "organization", organizationId: "3101" },
    ];
    for (const query of accepted) {
      expect(winRateDistributionQuerySchema.safeParse(query).success, JSON.stringify(query)).toBe(true);
    }

    const rejected = [
      // 전국은 지역·기관 축을 갖지 않는다. mart의 check 제약과 같은 규칙이다.
      { ...nationalCohort, regionCodeValueId: "41" },
      { ...nationalCohort, organizationId: "3101" },
      { ...nationalCohort, scope: "province" },
      { ...nationalCohort, scope: "district", organizationId: "3101" },
      { ...nationalCohort, scope: "organization" },
      { ...nationalCohort, scope: "organization", regionCodeValueId: "41" },
      { ...nationalCohort, scope: "province", regionCodeValueId: "41", organizationId: "3101" },
      { ...nationalCohort, scope: "nation" },
    ];
    for (const query of rejected) {
      expect(winRateDistributionQuerySchema.safeParse(query).success, JSON.stringify(query)).toBe(false);
    }
  });

  test("하한율과 낙찰방식은 필수이고 칸 폭·집계 단위는 기본값을 갖는다", () => {
    const parsed = winRateDistributionQuerySchema.parse(nationalCohort);
    expect(parsed.binWidth).toBe("0.010");
    expect(parsed.granularity).toBe("total");
    // 이 둘을 선택 값으로 두고 서버가 고르면 그 선택이 숨은 제품 판단이 된다(설계 §3.2).
    expect(winRateDistributionQuerySchema.safeParse({ scope: "national", awardMethod: "31" }).success).toBe(false);
    expect(winRateDistributionQuerySchema.safeParse({ scope: "national", floorRate: "90.000" }).success).toBe(false);
  });

  test("기간을 생략할 수 있고 뒤집힌 기간과 12개월 초과 창을 거부한다", () => {
    // 기본 기간은 현재 시각의 함수라 정적 schema가 아니라 use case가 정한다.
    expect(winRateDistributionQuerySchema.parse(nationalCohort).from).toBeUndefined();
    expect(winRateDistributionQuerySchema.safeParse({ ...nationalCohort, from: "2026-09", to: "2026-09" }).success).toBe(true);
    expect(winRateDistributionQuerySchema.safeParse({ ...nationalCohort, from: "2025-10", to: "2026-09" }).success).toBe(true);
    expect(winRateDistributionQuerySchema.safeParse({ ...nationalCohort, from: "2026-09", to: "2025-10" }).success).toBe(false);
    expect(winRateDistributionQuerySchema.safeParse({ ...nationalCohort, from: "2025-09", to: "2026-09" }).success).toBe(false);
    // 한쪽만 준 기간은 나머지 끝을 use case가 지어내야 하므로 응답만으로 표본을 재현할 수 없다.
    expect(winRateDistributionQuerySchema.safeParse({ ...nationalCohort, from: "2026-01" }).success).toBe(false);
    expect(winRateDistributionQuerySchema.safeParse({ ...nationalCohort, to: "2026-01" }).success).toBe(false);
  });

  test("칸 폭은 사정률 축이 아니라 0~100으로 닫힌 하한율 축 정밀도를 따른다", () => {
    expect(winRateDistributionQuerySchema.safeParse({ ...nationalCohort, binWidth: "0.05" }).success).toBe(false);
    expect(winRateDistributionQuerySchema.parse({ ...nationalCohort, binWidth: "0.050" }).binWidth).toBe("0.050");
  });

  test("query schema는 OpenAPI parameter 생성을 위해 ZodObject로 남는다", () => {
    // union query는 openapi.ts의 queryObject가 조용히 parameter 0개로 만든다(설계 §1).
    expect(winRateDistributionQuerySchema instanceof z.ZodObject).toBe(true);
    expect(Object.keys(winRateDistributionQuerySchema.shape).toSorted()).toEqual([
      "awardMethod",
      "binWidth",
      "floorRate",
      "from",
      "granularity",
      "organizationId",
      "regionCodeValueId",
      "scope",
      "to",
    ]);
  });

  test("응답은 칸 목록·중앙 칸·최빈 구간·달 목록과 계보 meta를 요구한다", () => {
    const response = {
      bins: [bin("90.000", "90.010", 20), bin("90.030", "90.040", 8)],
      medianBin: { from: { value: "90.030", unit: "percentage-points" }, to: { value: "90.040", unit: "percentage-points" } },
      modeRange: { ...bin("90.000", "90.010", 20), share: { value: "0.243902", unit: "ratio" } },
      months: [{ month: "2026-09", sampleCount: 28, coverage: "unknown", bins: null }],
      meta: { ...emptyMeta, sampleCount: 82 },
    };
    expect(winRateDistributionV1ResponseSchema.parse(response)).toEqual(response);

    // 활성 build가 없으면 빈 결과이며 계보 전부 null이다. 그것은 오류가 아니다(ADR 0011·0034).
    expect(winRateDistributionV1ResponseSchema.safeParse({
      bins: [], medianBin: null, modeRange: null, months: [], meta: emptyMeta,
    }).success).toBe(true);
  });

  test("응답 상한이 12개월과 4096칸을 넘는 목록을 거부한다", () => {
    const month = { month: "2026-09", sampleCount: 0, coverage: null, bins: null };
    const base = { bins: [], medianBin: null, modeRange: null, meta: emptyMeta };
    expect(winRateDistributionV1ResponseSchema.safeParse({ ...base, months: Array.from({ length: 12 }, () => month) }).success).toBe(true);
    expect(winRateDistributionV1ResponseSchema.safeParse({ ...base, months: Array.from({ length: 13 }, () => month) }).success).toBe(false);
    const manyBins = Array.from({ length: 4097 }, () => bin("90.000", "90.010", 1));
    expect(winRateDistributionV1ResponseSchema.safeParse({ ...base, months: [], bins: manyBins }).success).toBe(false);
  });

  test("칸 경계는 100을 넘는 관측을 담고 하한율은 0~100으로 닫힌다", () => {
    // 단가입찰 코호트의 사정률은 100을 넘는 관측이 있다(atoms/decimal.ts). 하한율은 그 축이 아니다.
    const base = { bins: [bin("104.000", "104.010", 1)], medianBin: null, modeRange: null, months: [], meta: emptyMeta };
    expect(winRateDistributionV1ResponseSchema.safeParse(base).success).toBe(true);
    expect(winRateDistributionV1ResponseSchema.safeParse({
      ...base,
      meta: { ...emptyMeta, floorRate: { value: "104.000", unit: "percentage-points" } },
    }).success).toBe(false);
  });

  test("실패 status마다 Problem Details schema를 공개한다", () => {
    expect(operation.problemStatuses).toEqual([400, 401, 404, 500, 503]);
    for (const status of operation.problemStatuses) {
      expect(operation.problemResponses[status]?.schema).toBeDefined();
    }
    expect(operation.successResponses[200]?.schema).toBe(winRateDistributionV1ResponseSchema);
  });
});
