import { describe, expect, test } from "bun:test";

import { publicHttpOperationRegistry } from "../../registry";
import { eligibilityAreaV1Operations } from "./operations";
import { listEligibilityAreasV1ResponseSchema } from "./list-eligibility-areas.response";
import { previewRegionCoverageCommandSchema } from "./region-coverage.command";
import { regionCoverageV1ResponseSchema } from "./region-coverage.response";

const list = eligibilityAreaV1Operations.listEligibilityAreas;
const preview = eligibilityAreaV1Operations.previewRegionCoverage;

const area = (codeValueId: string, code: string, label: string | null) => ({
  codeValueId,
  code,
  scheme: "eat:eligibility-area",
  label,
});

const lineage = {
  buildId: "212",
  sourceReleaseId: "0f5f5d3c-6a1b-4f2e-9c8d-1a2b3c4d5e6f",
  calcVersion: "mart-r3",
  computedAt: "2026-09-09T10:30:00Z",
  coverage: "unknown",
  regionScheme: null,
};

describe("참가제한지역 operation 계약", () => {
  test("공개 registry가 두 operation을 각각 한 번만 갖는다", () => {
    for (const operationId of ["listEligibilityAreas", "previewRegionCoverage"]) {
      const found = publicHttpOperationRegistry.filter((operation) => operation.operationId === operationId);
      expect(found.length).toBe(1);
      expect(found[0]?.implementationOwner).toBe("server");
    }
  });

  test("semantic route에서 versioned 경로가 파생된다", () => {
    expect(list.method).toBe("get");
    expect(list.openApiPath).toBe("/api/v1/eligibility-areas");
    expect(preview.method).toBe("post");
    expect(preview.openApiPath).toBe("/api/v1/eligibility-areas/coverage");
  });

  test("목록 응답은 시도 묶음과 라벨 결측 수를 함께 싣는다", () => {
    const parsed = listEligibilityAreasV1ResponseSchema.safeParse({
      scheme: "eat:eligibility-area",
      groups: [
        {
          all: area("9101", "15000", "경남/전체"),
          parts: [area("9102", "15653", "경남/김해시"), area("9103", "15714", "경남/창원시")],
        },
        // 라벨이 관측되지 않은 시도 묶음도 감추지 않는다(실측 186개 중 2개).
        { all: area("9201", "05000", null), parts: [] },
      ],
      meta: { areaCount: 4, unlabeledAreaCount: 1 },
    });
    expect(parsed.success).toBe(true);
    expect(list.successStatuses).toEqual([200]);
  });

  test("미리보기 command는 빈 선택을 받고 코드 상한을 넘기면 거부한다", () => {
    expect(previewRegionCoverageCommandSchema.safeParse({ codeValueIds: [] }).success).toBe(true);
    expect(previewRegionCoverageCommandSchema.safeParse({ codeValueIds: ["9102"] }).success).toBe(true);
    expect(previewRegionCoverageCommandSchema.safeParse({ codeValueIds: ["0"] }).success).toBe(false);
    const tooMany = Array.from({ length: 201 }, (_, index) => String(index + 1));
    expect(previewRegionCoverageCommandSchema.safeParse({ codeValueIds: tooMany }).success).toBe(false);
  });

  test("미리보기 응답은 오늘 셋과 과거 창을 나눠 싣고 공고가 없던 창을 null로 말한다", () => {
    const parsed = regionCoverageV1ResponseSchema.safeParse({
      today: { matchedCount: 9, unobservedCount: 7, nationwideCount: 404 },
      window: {
        windowStart: "2026-06-11T00:00:00Z",
        windowEnd: "2026-09-09T10:30:00Z",
        daysWithAuctions: 27,
        medianDayCount: 14,
        peakDay: { date: "2026-06-22", count: 117 },
      },
      meta: { asOf: "2026-09-09T10:30:00Z", openAuctionSnapshotBuild: lineage },
    });
    expect(parsed.success).toBe(true);
    expect(regionCoverageV1ResponseSchema.safeParse({
      today: { matchedCount: 0, unobservedCount: 0, nationwideCount: 404 },
      window: {
        windowStart: "2026-06-11T00:00:00Z",
        windowEnd: "2026-09-09T10:30:00Z",
        daysWithAuctions: 0,
        medianDayCount: null,
        peakDay: null,
      },
      meta: { asOf: "2026-09-09T10:30:00Z", openAuctionSnapshotBuild: lineage },
    }).success).toBe(true);
    // 하루는 KST 달력일이며 시각 문자열을 받지 않는다.
    expect(regionCoverageV1ResponseSchema.safeParse({
      today: { matchedCount: 0, unobservedCount: 0, nationwideCount: 0 },
      window: {
        windowStart: "2026-06-11T00:00:00Z",
        windowEnd: "2026-09-09T10:30:00Z",
        daysWithAuctions: 1,
        medianDayCount: 1,
        peakDay: { date: "2026-06-22T00:00:00Z", count: 1 },
      },
      meta: { asOf: "2026-09-09T10:30:00Z", openAuctionSnapshotBuild: lineage },
    }).success).toBe(false);
  });

  test("두 operation 모두 미로그인은 401이고 목록에는 404를 두지 않는다", () => {
    expect(list.problemStatuses).toEqual([401, 500, 503]);
    expect(preview.problemStatuses).toEqual([400, 401, 500, 503]);
  });
});
