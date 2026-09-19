import { describe, expect, test } from "bun:test";
import { z } from "zod";

import { parseAnalysisFilterValue, parseAnalysisMeta, assertAnalysisFilterSupported } from "../../../codecs/analysis";
import { analysisFilterValueSchema, analysisFilterOptionsSchema, analysisMetaSchema } from "./index";
import { analysisFilterFixture, analysisMetaFixture, analysisOptionsFixture } from "./__fixtures__/analysis";

describe("공통 분석 필터 계약", () => {
  test("양끝·한쪽·전체 명단 범위와 전국 비교를 ID 손실 없이 보존한다", () => {
    for (const listCountRange of [{ min: 12, max: 24 }, { min: 0, max: 0 }, { min: 12, max: null }, { min: null, max: 24 }, { min: null, max: null }]) {
      const value = parseAnalysisFilterValue({ ...analysisFilterFixture, listCountRange, comparisonScope: { kind: "national" }, excludeAttemptId: null });
      expect(value.targetOrganizationId).toBe("9007199254740993");
      expect(value.listCountRange).toEqual(listCountRange);
      expect(value.excludeAttemptId).toBeNull();
    }
  });

  test("명단 역전·음수·소수와 달력일 오류·날짜 역전을 거부한다", () => {
    for (const listCountRange of [{ min: 24, max: 12 }, { min: -1, max: null }, { min: 1.5, max: 2 }]) {
      expect(() => parseAnalysisFilterValue({ ...analysisFilterFixture, listCountRange })).toThrow();
    }
    for (const period of [{ from: "2026-02-30", to: "2026-03-14" }, { from: "2026-03-14", to: "2026-01-15" }]) {
      expect(() => parseAnalysisFilterValue({ ...analysisFilterFixture, period })).toThrow();
    }
    expect(parseAnalysisFilterValue({ ...analysisFilterFixture, period: { from: "2024-02-29", to: "2024-02-29" } }).period.from).toBe("2024-02-29");
  });

  test("공고지역과 참가제한·행안부 체계를 섞거나 라벨을 ID로 쓰지 못한다", () => {
    for (const scheme of ["eat:eligibility-area", "mois:administrative-region"]) {
      expect(analysisFilterValueSchema.safeParse({ ...analysisFilterFixture, comparisonScope: { kind: "region", scheme, codeValueId: "41" } }).success).toBe(false);
    }
    expect(analysisFilterValueSchema.safeParse({ ...analysisFilterFixture, targetOrganizationId: "남산초" }).success).toBe(false);
    expect(analysisFilterValueSchema.safeParse({ ...analysisFilterFixture, comparisonItemFilter: { kind: "all" } }).success).toBe(false);
  });

  test("겹쳐 찍을 기관은 고른 순서를 지키고 여섯을 넘기면 거부한다", () => {
    // 표시 축이라 표본 수를 바꾸지 않지만 주소에 실려 공유되므로 순서가 곧 색과 번호다.
    const 셋 = parseAnalysisFilterValue({ ...analysisFilterFixture, overlayOrganizationIds: ["31", "12", "7"] });
    expect(셋.overlayOrganizationIds).toEqual(["31", "12", "7"]);
    expect(parseAnalysisFilterValue(analysisFilterFixture).overlayOrganizationIds).toEqual([]);
    // 상한은 색과 자리가 감당하는 수다(PDR-0007). 넘긴 것을 조용히 자르면 무엇이 빠졌는지 알 수 없다.
    const 일곱 = ["1", "2", "3", "4", "5", "6", "7"];
    expect(analysisFilterValueSchema.safeParse({ ...analysisFilterFixture, overlayOrganizationIds: 일곱 }).success).toBe(false);
    expect(analysisFilterValueSchema.safeParse({ ...analysisFilterFixture, overlayOrganizationIds: ["창원초"] }).success).toBe(false);
  });

  test("미확인 지역 ID를 기본 지역으로 치환하지 않는다", () => {
    const options = analysisFilterOptionsSchema.parse(analysisOptionsFixture);
    const filter = parseAnalysisFilterValue(analysisFilterFixture);
    expect(() => assertAnalysisFilterSupported(filter, options)).not.toThrow();
    expect(() => assertAnalysisFilterSupported({ ...filter, comparisonScope: { kind: "region", scheme: "eat:auction-location-sido", codeValueId: "999" } }, options)).toThrow();
  });

  test("품목 원자는 어휘 밖을 schema가 끊고 미확인만 보기는 원자와 함께 오지 못한다", () => {
    expect(analysisFilterValueSchema.safeParse({ ...analysisFilterFixture, itemFilter: { kind: "atoms", atoms: ["육류", "김치류"], unknown: true } }).success).toBe(true);
    expect(analysisFilterValueSchema.safeParse({ ...analysisFilterFixture, itemFilter: { kind: "unknown" } }).success).toBe(true);
    // 어휘 밖 조각과 빈 선택은 값이 아니다. 빈 배열을 받으면 "전체"와 "아무것도 안 고름"이 같아진다.
    expect(analysisFilterValueSchema.safeParse({ ...analysisFilterFixture, itemFilter: { kind: "atoms", atoms: ["축산"], unknown: false } }).success).toBe(false);
    expect(analysisFilterValueSchema.safeParse({ ...analysisFilterFixture, itemFilter: { kind: "atoms", atoms: [], unknown: false } }).success).toBe(false);
  });

  test("비활성 지역·지원 밖 하한율과 방식은 거부한다", () => {
    const options = analysisFilterOptionsSchema.parse(analysisOptionsFixture);
    const filter = parseAnalysisFilterValue({ ...analysisFilterFixture, itemFilter: { kind: "atoms", atoms: ["육류"], unknown: false } });
    expect(() => assertAnalysisFilterSupported(filter, options)).not.toThrow();
    expect(() => assertAnalysisFilterSupported(filter, { ...options, regions: options.regions.map((region) => ({ ...region, active: false })) })).toThrow();
    expect(() => assertAnalysisFilterSupported({ ...filter, floorRate: { value: "88.000", unit: "percentage-points" } }, options)).toThrow();
    expect(() => assertAnalysisFilterSupported({ ...filter, awardMethodCodeValueId: "999" }, options)).toThrow();
  });

  test("지원 선택지의 보유 날짜도 실제 달력일과 순서를 검사한다", () => {
    const filter = parseAnalysisFilterValue(analysisFilterFixture);
    for (const period of [{ from: "2026-02-30", to: "2026-03-01" }, { from: "2026-03-01", to: "2026-02-01" }]) {
      const options = analysisFilterOptionsSchema.parse({ ...analysisOptionsFixture, availablePeriods: { opened: period, announced: null } });
      expect(() => assertAnalysisFilterSupported(filter, options)).toThrow();
    }
  });
});

describe("분석 표본과 스냅샷 계약", () => {
  test("같은 스냅샷 안에서 다른 mart build 번호와 실제 겹침 수를 보존한다", () => {
    const meta = parseAnalysisMeta(analysisMetaFixture);
    if (meta.state !== "ready") throw new Error("조회 가능 상태여야 합니다.");
    expect(meta.snapshot.builds.map((build) => build.lineage.buildId)).toEqual(["501", "907"]);
    expect(meta.overlapCount).toBe(6);
  });

  test("실제 0건과 스냅샷 미발행을 구분하고 없는 표본 수를 만들지 않는다", () => {
    const empty = parseAnalysisMeta({ ...analysisMetaFixture, targetSampleCount: 0, comparisonSampleCount: 0, overlapCount: 0 });
    expect(empty.state).toBe("ready");
    const missing = { state: "unavailable", effectiveFilter: analysisFilterFixture, reason: "snapshot-unavailable" };
    expect(parseAnalysisMeta(missing).state).toBe("unavailable");
    expect(analysisMetaSchema.safeParse({ ...missing, targetSampleCount: 0 }).success).toBe(false);
  });

  test("표본보다 큰 겹침·중복 build 역할·역전된 보존 시각을 거부한다", () => {
    expect(() => parseAnalysisMeta({ ...analysisMetaFixture, overlapCount: 9 })).toThrow();
    expect(() => parseAnalysisMeta({ ...analysisMetaFixture, snapshot: { ...analysisMetaFixture.snapshot, builds: [analysisMetaFixture.snapshot.builds[0], analysisMetaFixture.snapshot.builds[0]] } })).toThrow();
    expect(() => parseAnalysisMeta({ ...analysisMetaFixture, snapshot: { ...analysisMetaFixture.snapshot, expiresAt: "2026-09-14T00:00:00Z" } })).toThrow();
  });

  test("전국 전체에는 기관 표본 전부가 들어가므로 겹침 수가 기관 수와 같다", () => {
    const national = { ...analysisMetaFixture, effectiveFilter: { ...analysisFilterFixture, comparisonScope: { kind: "national" } } };
    expect(() => parseAnalysisMeta(national)).toThrow();
    expect(parseAnalysisMeta({ ...national, overlapCount: 8 }).state).toBe("ready");
  });

  test("스냅샷은 관측 build를 반드시 싣고 읽지 않은 mart의 계보는 싣지 않는다", () => {
    const [observations, distribution] = analysisMetaFixture.snapshot.builds;
    const withBuilds = (builds: unknown) =>
      parseAnalysisMeta({ ...analysisMetaFixture, snapshot: { ...analysisMetaFixture.snapshot, builds } });
    // 분포 mart를 읽지 않는 조회는 그 계보를 싣지 않는다. 실으면 답이 그것에 의존한다고 말하는
    // 것이고, 그 mart가 회수되면 답과 무관한 이유로 응답이 깨진다(EAT-198 측정).
    expect(withBuilds([observations]).state).toBe("ready");
    // 관측 build 없이 분포 build만 싣는 것은 어느 자료를 읽었는지 말하지 않는 것이다.
    expect(() => withBuilds([distribution])).toThrow();
    expect(() => withBuilds([observations, observations])).toThrow();
    expect(() => withBuilds([])).toThrow();
  });

  test("미반영 발행 15분 경계와 갱신 상태가 다르면 거부한다", () => {
    const freshness = { checkedAt: "2026-09-14T01:15:00Z", oldestPendingPublicationAt: "2026-09-14T01:00:00Z" };
    expect(parseAnalysisMeta({ ...analysisMetaFixture, freshness: { ...freshness, state: "updating" } }).state).toBe("ready");
    expect(() => parseAnalysisMeta({ ...analysisMetaFixture, freshness: { ...freshness, state: "delayed" } })).toThrow();
    const over = { ...freshness, checkedAt: "2026-09-14T01:15:00.001Z" };
    expect(parseAnalysisMeta({ ...analysisMetaFixture, freshness: { ...over, state: "delayed" } }).state).toBe("ready");
    expect(() => parseAnalysisMeta({ ...analysisMetaFixture, freshness: { ...over, state: "updating" } })).toThrow();
  });

  test("coverage 기간 누락·중복과 검사 시각보다 미래인 미반영 발행을 거부한다", () => {
    expect(() => parseAnalysisMeta({ ...analysisMetaFixture, periodCoverage: [] })).toThrow();
    expect(() => parseAnalysisMeta({ ...analysisMetaFixture, periodCoverage: [analysisMetaFixture.periodCoverage[0], analysisMetaFixture.periodCoverage[0]] })).toThrow();
    expect(() => parseAnalysisMeta({ ...analysisMetaFixture, freshness: { state: "updating", checkedAt: "2026-09-14T01:11:00Z", oldestPendingPublicationAt: "2026-09-14T02:00:00Z" } })).toThrow();
  });

  test("wire 계약은 실행 predicate 없이 JSON Schema로 변환된다", () => {
    for (const schema of [analysisFilterValueSchema, analysisFilterOptionsSchema, analysisMetaSchema]) {
      expect(z.toJSONSchema(schema)).toHaveProperty("$schema");
    }
  });
});
