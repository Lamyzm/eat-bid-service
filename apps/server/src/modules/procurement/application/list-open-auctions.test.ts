import { describe, expect, test } from "bun:test";
import { baseRelativeBidRate, bidRate, canonicalDecimal, fixedClock, krw, Temporal } from "@eatbid/domain";
import { EffectRunner } from "../../../platform/effect/effect-runner";
import type { OpenAuctionQuery, OpenAuctionRecord } from "./open-auction-reader";

const record: OpenAuctionRecord = {
  auctionAttemptId: 5_796_468n,
  organization: { organizationId: 3_101n, label: "창원 남산초등학교", type: "unknown" },
  itemLabel: "축산",
  floorRate: bidRate(canonicalDecimal("90.000", 3)),
  region: {
    sido: { codeValueId: 41n, code: "48", scheme: "eat:auction-location-sido", label: "경상남도" },
    sigungu: null,
  },
  termsRevisionId: 5_796_469n,
  closesAt: Temporal.Instant.from("2026-09-08T02:00:00Z"),
  baseAmount: krw(canonicalDecimal("2761700.00", 2)),
  bidCount: 5,
  observedAt: Temporal.Instant.from("2026-09-07T00:30:00Z"),
  sourceLastChangedAt: null,
  orgSummary: {
    attemptCount: 17,
    medianListCount: 5,
    listCountSampleCount: 12,
    lastRound: {
      auctionAttemptId: 5_780_681n,
      openedAt: Temporal.Instant.from("2026-09-02T02:00:00Z"),
      // 같은 낙찰의 투찰률 축 표현이다. 사정률과 값이 다른 것이 축이 다르다는 증거다.
      awardedBidRate: baseRelativeBidRate(canonicalDecimal("88.3020", 4)),
      dayFloorBidRate: baseRelativeBidRate(canonicalDecimal("88.0350", 4)),
      listCount: 17,
      belowDayFloorCount: 2,
    },
  },
};

const lineage = {
  buildId: 601n,
  sourceReleaseId: "0f5f5d3c-6a1b-4f2e-9c8d-1a2b3c4d5e6f",
  calcVersion: "mart-r2",
  computedAt: Temporal.Instant.from("2026-09-07T00:10:00Z"),
  coverage: "unknown",
  regionScheme: "eat:auction-location-sigungu",
} as const;

const nullLineageWire = {
  buildId: null,
  sourceReleaseId: null,
  calcVersion: null,
  computedAt: null,
  coverage: null,
  regionScheme: null,
};

const input = {
  regionCodeValueId: null,
  itemLabel: null,
  closesWithinHours: null,
  baseAmountMin: null,
  baseAmountMax: null,
  cursor: null,
  limit: 50,
} as const;

// "열림" 기준 시각은 clock에서만 온다. 고정 clock이어야 응답의 asOf를 문자 그대로 검사할 수 있다.
const NOW = Temporal.Instant.from("2026-09-07T01:30:00Z");
const clock = fixedClock(NOW);

async function loadUseCase() {
  const application = await import("./list-open-auctions").catch(() => undefined);
  expect(application, "열린 공고 목록 use case가 있어야 한다").toBeDefined();
  return application!;
}

describe("ListOpenAuctions 조회 use case", () => {
  test("스냅샷 행과 기관 요약을 공개 응답으로 직렬화하고 meta에 두 build의 계보를 이름 붙여 싣는다", async () => {
    const { ListOpenAuctions } = await loadUseCase();
    const observed: OpenAuctionQuery[] = [];
    const useCase = new ListOpenAuctions({
      listOpen: async (query) => {
        observed.push(query);
        return {
          kind: "page",
          page: {
            auctions: [record],
            nextCursor: 5_796_468n,
            sampleCount: 70,
            snapshotLineage: lineage,
            orgSummaryLineage: { ...lineage, buildId: 501n, calcVersion: "mart-r1" },
          },
        };
      },
    }, clock);
    const response = await new EffectRunner().run(useCase.execute(input));
    expect(observed).toEqual([{ ...input, asOf: NOW }]);
    expect(response.nextCursor).toBe("5796468");
    expect(response.auctions).toEqual([{
      auctionAttemptId: "5796468",
      organization: { organizationId: "3101", label: "창원 남산초등학교", type: "unknown" },
      itemLabel: "축산",
      floorRate: { value: "90.000", unit: "percentage-points" },
      region: {
        sido: { codeValueId: "41", code: "48", scheme: "eat:auction-location-sido", label: "경상남도" },
        sigungu: null,
      },
      termsRevisionId: "5796469",
      closesAt: "2026-09-08T02:00:00Z",
      baseAmount: { amount: "2761700.00", currency: "KRW" },
      bidCount: 5,
      observedAt: "2026-09-07T00:30:00Z",
      sourceLastChangedAt: null,
      orgSummary: {
        attemptCount: 17,
        medianListCount: 5,
        listCountSampleCount: 12,
        lastRound: {
          auctionAttemptId: "5780681",
          openedAt: "2026-09-02T02:00:00Z",
          awardedBidRate: { value: "88.3020", unit: "percentage-points" },
          dayFloorBidRate: { value: "88.0350", unit: "percentage-points" },
          listCount: 17,
          belowDayFloorCount: 2,
        },
      },
    }]);
    expect(response.meta).toEqual({
      sampleCount: 70,
      asOf: "2026-09-07T01:30:00Z",
      region: null,
      item: null,
      closesWithinHours: null,
      baseAmountMin: null,
      baseAmountMax: null,
      openAuctionSnapshotBuild: {
        buildId: "601",
        sourceReleaseId: "0f5f5d3c-6a1b-4f2e-9c8d-1a2b3c4d5e6f",
        calcVersion: "mart-r2",
        computedAt: "2026-09-07T00:10:00Z",
        coverage: "unknown",
        regionScheme: "eat:auction-location-sigungu",
      },
      orgRoundSummaryBuild: {
        buildId: "501",
        sourceReleaseId: "0f5f5d3c-6a1b-4f2e-9c8d-1a2b3c4d5e6f",
        calcVersion: "mart-r1",
        computedAt: "2026-09-07T00:10:00Z",
        coverage: "unknown",
        regionScheme: "eat:auction-location-sigungu",
      },
    });
  });

  test("활성 build가 없으면 계보 둘이 모두 null이고 오류가 아니다", async () => {
    const { ListOpenAuctions } = await loadUseCase();
    const useCase = new ListOpenAuctions({
      listOpen: async () => ({
        kind: "page",
        page: { auctions: [], nextCursor: null, sampleCount: 0, snapshotLineage: null, orgSummaryLineage: null },
      }),
    }, clock);
    const response = await new EffectRunner().run(useCase.execute(input));
    expect(response.auctions).toEqual([]);
    expect(response.meta.openAuctionSnapshotBuild).toEqual(nullLineageWire);
    expect(response.meta.orgRoundSummaryBuild).toEqual(nullLineageWire);
  });

  test("스냅샷 build만 있으면 기관 요약 계보만 null이다", async () => {
    const { ListOpenAuctions } = await loadUseCase();
    const useCase = new ListOpenAuctions({
      listOpen: async () => ({
        kind: "page",
        page: {
          auctions: [{ ...record, orgSummary: null }],
          nextCursor: null,
          sampleCount: 1,
          snapshotLineage: lineage,
          orgSummaryLineage: null,
        },
      }),
    }, clock);
    const response = await new EffectRunner().run(useCase.execute(input));
    expect(response.meta.openAuctionSnapshotBuild.buildId).toBe("601");
    expect(response.meta.orgRoundSummaryBuild).toEqual(nullLineageWire);
    expect(response.auctions[0]!.orgSummary).toBeNull();
  });

  test("기관을 찾지 못한 스냅샷 행은 organization이 null이고 기관 요약도 null이다", async () => {
    const { ListOpenAuctions } = await loadUseCase();
    const useCase = new ListOpenAuctions({
      listOpen: async () => ({
        kind: "page",
        page: {
          auctions: [{ ...record, organization: null, orgSummary: null, region: null, itemLabel: null, floorRate: null, termsRevisionId: null }],
          nextCursor: null,
          sampleCount: 1,
          snapshotLineage: lineage,
          orgSummaryLineage: lineage,
        },
      }),
    }, clock);
    const response = await new EffectRunner().run(useCase.execute(input));
    expect(response.auctions[0]).toMatchObject({
      organization: null,
      orgSummary: null,
      region: null,
      itemLabel: null,
      floorRate: null,
      termsRevisionId: null,
    });
  });

  test("meta는 요청 필터를 그대로 되돌려 실어 표본 수의 코호트를 응답만으로 닫는다", async () => {
    const { ListOpenAuctions } = await loadUseCase();
    const useCase = new ListOpenAuctions({
      listOpen: async () => ({
        kind: "page",
        page: { auctions: [], nextCursor: null, sampleCount: 0, snapshotLineage: lineage, orgSummaryLineage: lineage },
      }),
    }, clock);
    const response = await new EffectRunner().run(useCase.execute({
      regionCodeValueId: 41n,
      itemLabel: "축산",
      closesWithinHours: 72,
      baseAmountMin: "2000000.00",
      baseAmountMax: "3000000.00",
      cursor: null,
      limit: 20,
    }));
    expect(response.meta).toMatchObject({
      sampleCount: 0,
      region: "41",
      item: "축산",
      closesWithinHours: 72,
      baseAmountMin: "2000000.00",
      baseAmountMax: "3000000.00",
    });
  });

  test("cursor가 활성 build에 없으면 VALIDATION_ERROR로 닫는다", async () => {
    const { ListOpenAuctions, OpenAuctionCursorInvalid } = await loadUseCase();
    const useCase = new ListOpenAuctions({
      listOpen: async (query) => ({ kind: "cursor-not-found", cursor: query.cursor ?? 0n }),
    }, clock);
    const failure = await new EffectRunner().run(useCase.execute({ ...input, cursor: 9_007_199_254_740_993n }))
      .then(() => undefined, (error: unknown) => error);
    expect(failure).toBeInstanceOf(OpenAuctionCursorInvalid);
    expect((failure as { code: string }).code).toBe("VALIDATION_ERROR");
  });

  test("reader가 실패하면 DEPENDENCY_UNAVAILABLE로 번역한다", async () => {
    const { ListOpenAuctions } = await loadUseCase();
    const { ProcurementDependencyUnavailable } = await import("./failures");
    const useCase = new ListOpenAuctions({
      listOpen: async () => { throw new Error("database offline"); },
    }, clock);
    const failure = await new EffectRunner().run(useCase.execute(input))
      .then(() => undefined, (error: unknown) => error);
    expect(failure).toBeInstanceOf(ProcurementDependencyUnavailable);
    expect((failure as { code: string }).code).toBe("DEPENDENCY_UNAVAILABLE");
  });
});
