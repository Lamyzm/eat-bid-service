import { describe, expect, test } from "bun:test";

import { publicHttpOperationRegistry } from "../../registry";
import { analysisV1Operations } from "./operations";

const findTimeSeries = analysisV1Operations.findTimeSeries;

const 기본질의 = {
  organizationId: "1",
  from: "2026-01-01",
  to: "2026-03-31",
  dateBasis: "opened",
  comparisonScope: "national",
  floorRate: "90.000",
  awardMethodCodeValueId: "31",
} as const;

function 통과하나(query: Record<string, unknown>): boolean {
  return findTimeSeries.querySchema.safeParse(query).success;
}

function 실패한자리(query: Record<string, unknown>): readonly string[] {
  const result = findTimeSeries.querySchema.safeParse(query);
  return result.success ? [] : result.error.issues.map((issue) => String(issue.path[0]));
}

describe("분석 시간축 operation 계약", () => {
  test("공개 registry가 이 operation을 한 번만 갖는다", () => {
    const found = publicHttpOperationRegistry.filter((operation) => operation.operationId === "findAnalysisTimeSeries");
    expect(found).toHaveLength(1);
    expect(found[0]!.method).toBe("get");
    // 경로는 operation이 소유한다. 화면이나 서버가 `/api/v1/...` 문자열을 따로 적지 않는다(AGENTS 19).
    expect(found[0]!.route.resource).toBe("analysis");
  });

  test("전국 비교는 지역 축을 가질 수 없고 지역 비교는 체계와 코드값을 함께 가져야 한다", () => {
    expect(통과하나(기본질의)).toBe(true);
    // 전국인데 지역을 주면 어느 모집단을 세는지가 두 가지로 읽힌다.
    expect(실패한자리({ ...기본질의, comparisonRegionCodeValueId: "7" })).toContain("comparisonRegionCodeValueId");
    // 코드값만 주면 그 숫자가 시도인지 시군구인지 말하지 않는다. eaT 공고지역은 둘이 다른 체계다(AGENTS 6).
    expect(실패한자리({ ...기본질의, comparisonScope: "region", comparisonRegionCodeValueId: "7" }))
      .toContain("comparisonRegionScheme");
    expect(실패한자리({ ...기본질의, comparisonScope: "region", comparisonRegionScheme: "eat:auction-location-sido" }))
      .toContain("comparisonRegionCodeValueId");
    expect(통과하나({
      ...기본질의,
      comparisonScope: "region",
      comparisonRegionScheme: "eat:auction-location-sido",
      comparisonRegionCodeValueId: "7",
    })).toBe(true);
  });

  test("참가제한지역이나 행안부 코드 체계는 비교 축이 될 수 없다", () => {
    for (const scheme of ["eat:eligibility-area", "mois:administrative-region"]) {
      expect(통과하나({
        ...기본질의,
        comparisonScope: "region",
        comparisonRegionScheme: scheme,
        comparisonRegionCodeValueId: "7",
      })).toBe(false);
    }
  });

  test("기간은 양끝 포함 달력일이고 역전되거나 상한을 넘을 수 없다", () => {
    // 월 단위가 아니라 날 단위라 월 중간을 고를 수 있다. 이것이 기존 두 조회와 갈리는 자리다.
    expect(통과하나({ ...기본질의, from: "2026-01-15", to: "2026-02-14" })).toBe(true);
    expect(실패한자리({ ...기본질의, from: "2026-03-31", to: "2026-01-01" })).toContain("to");
    expect(실패한자리({ ...기본질의, from: "2020-01-01", to: "2026-12-31" })).toContain("to");
    // 하루짜리 기간은 양끝이 같은 날이며 유효하다.
    expect(통과하나({ ...기본질의, from: "2026-02-14", to: "2026-02-14" })).toBe(true);
  });

  test("기간 길이는 윤년을 넘어도 달력일로 센다", () => {
    // 상한이 1,900일이므로 그 경계를 윤년이 낀 구간으로 민다. 2020-01-01부터 1,900번째 날이 2025-03-14다
    // (2020·2024가 윤년). 셈법이 틀리면 상한이 조용히 하루씩 어긋나고 그 사실은 화면에 안 남는다.
    expect(통과하나({ ...기본질의, from: "2020-01-01", to: "2025-03-14" })).toBe(true);
    expect(실패한자리({ ...기본질의, from: "2020-01-01", to: "2025-03-15" })).toContain("to");
    // 윤일 자체를 양끝으로 고른 기간도 유효하다.
    expect(통과하나({ ...기본질의, from: "2024-02-29", to: "2024-02-29" })).toBe(true);
  });

  test("명단 범위는 한쪽만 주어도 되고 0~0은 유효한 조건이다", () => {
    expect(통과하나({ ...기본질의, listCountMin: 12 })).toBe(true);
    expect(통과하나({ ...기본질의, listCountMax: 24 })).toBe(true);
    expect(통과하나({ ...기본질의, listCountMin: 12, listCountMax: 24 })).toBe(true);
    // 명단이 0인 판만 보겠다는 뜻이라 조건을 안 건 것과 다른 질문이다(PDR-0006).
    expect(통과하나({ ...기본질의, listCountMin: 0, listCountMax: 0 })).toBe(true);
    expect(실패한자리({ ...기본질의, listCountMin: 24, listCountMax: 12 })).toContain("listCountMax");
  });

  test("query로 오는 명단 경계는 문자열이며 그대로 통과한다", () => {
    // 실제 요청의 query는 언제나 문자열이다. 숫자 리터럴로만 검사하면 `?listCountMin=12`가 형식 오류로
    // 튕기는 것을 못 본다(2026-09-18 dev 실측).
    expect(통과하나({ ...기본질의, listCountMin: "12", listCountMax: "24" })).toBe(true);
    expect(실패한자리({ ...기본질의, listCountMin: "24", listCountMax: "12" })).toContain("listCountMax");
    expect(통과하나({ ...기본질의, listCountMin: "열둘" })).toBe(false);
    expect(통과하나({ ...기본질의, listCountMin: "12.5" })).toBe(false);
    expect(통과하나({ ...기본질의, listCountMin: "-1" })).toBe(false);
  });

  test("하한율은 0~100 축이라 관측 사정률의 100 초과 값을 받지 않는다", () => {
    expect(통과하나({ ...기본질의, floorRate: "88.500" })).toBe(true);
    // 사정률은 100을 넘지만 하한율은 정의상 넘지 않는다. 두 축을 한 atom으로 묶지 않는다(ADR 0040).
    expect(통과하나({ ...기본질의, floorRate: "120.000" })).toBe(false);
  });

  test("응답은 자료가 준비되지 않은 상태를 표본 0이 아니라 meta로 말한다", () => {
    const schema = findTimeSeries.successResponses[200].schema;
    const 미준비 = schema.safeParse({
      axis: null,
      target: null,
      targetTruncated: false,
      comparison: null,
      meta: {
        state: "unavailable",
        reason: "snapshot-unavailable",
        effectiveFilter: {
          targetOrganizationId: "1",
          excludeAttemptId: null,
          period: { from: "2026-01-01", to: "2026-03-31" },
          dateBasis: "opened",
          comparisonScope: { kind: "national" },
          floorRate: { value: "90.000", unit: "percentage-points" },
          awardMethodCodeValueId: "31",
          listCountRange: { min: null, max: null },
          targetItemFilter: { kind: "all" },
        },
      },
    });
    expect(미준비.success).toBe(true);
  });
});
