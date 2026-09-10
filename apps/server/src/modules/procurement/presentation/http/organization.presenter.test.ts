import { describe, expect, test } from "bun:test";
import { organizationAuctionAttemptsV1ResponseSchema } from "@eatbid/contracts";
import { baseRelativeBidRate, bidRate, canonicalDecimal, krw, observedBidRate, Temporal } from "@eatbid/domain";
import type { ListOrganizationAuctionAttemptsInput } from "../../application/list-organization-auction-attempts";
import type { MartBuildLineage } from "../../application/mart-build-lineage";
import type { OrganizationAttemptPage, OrganizationAttemptQuery, OrganizationAttemptRecord } from "../../application/organization-attempt-reader";
import { kstMonth } from "../../domain/kst-month";
import { organizationId } from "../../domain/organization-id";
import { toOrganizationAttemptsResponse } from "./organization.presenter";

const record: OrganizationAttemptRecord = {
  attemptId: 5_796_468n,
  revisionId: 208n,
  announcedAt: Temporal.Instant.from("2026-09-01T00:00:00Z"),
  openedAt: null,
  item: { codeValueId: 7n, label: "축산" },
  itemLabel: "축산",
  floorRate: bidRate(canonicalDecimal("90.000", 3)),
  awardMethodCodeValueId: null,
  baseAmount: krw(canonicalDecimal("2761700.00", 2)),
  winRate: observedBidRate(canonicalDecimal("90.309", 3)),
  secondRate: null,
  // 같은 낙찰의 투찰률 축 표현이다. 사정률 90.309와 값이 다른 것이 축이 다르다는 증거다.
  awardedBidRate: baseRelativeBidRate(canonicalDecimal("88.3020", 4)),
  dayFloorRate: baseRelativeBidRate(canonicalDecimal("88.0350", 4)),
  listCount: 17,
  belowDayFloorCount: 2,
  winnerSupplierPartyId: 9n,
  supersedesAttemptId: null,
};

// 계보는 행이 아니라 이 페이지를 읽은 build 하나가 갖는다(ADR 0034).
const lineage: MartBuildLineage = {
  buildId: 501n,
  sourceReleaseId: "0f5f5d3c-6a1b-4f2e-9c8d-1a2b3c4d5e6f",
  calcVersion: "mart-r1",
  computedAt: Temporal.Instant.from("2026-09-04T00:10:00Z"),
  coverage: "unknown",
  regionScheme: "eat:auction-location-sigungu",
};

const NOW = Temporal.Instant.from("2026-09-06T01:00:00Z");
const input: ListOrganizationAuctionAttemptsInput = {
  organizationId: organizationId(42n), itemCodeValueId: null, cursor: null, limit: 12, opened: "only",
};
const query: OrganizationAttemptQuery = {
  organizationId: input.organizationId, itemCodeValueId: null, cursor: null, limit: 12,
  expectedBuildId: null, openedAtOrBefore: NOW,
};

function pageOf(overrides: Partial<OrganizationAttemptPage>): OrganizationAttemptPage {
  return { attempts: [record], nextCursor: null, sampleCount: 1, lineage, ...overrides };
}

describe("기관 회차 이력 presenter", () => {
  test("회차 요약을 공개 응답으로 직렬화하고 meta는 활성 build의 계보를 싣는다", () => {
    const response = toOrganizationAttemptsResponse({
      input, query, page: pageOf({ nextCursor: 5_796_468n, sampleCount: 92 }),
    });
    expect(organizationAuctionAttemptsV1ResponseSchema.parse(response)).toEqual(response);
    expect(response.organizationId).toBe("42");
    expect(response.nextCursor).toBe("5796468");
    expect(response.attempts).toEqual([{
      attemptId: "5796468",
      announcedAt: "2026-09-01T00:00:00Z",
      openedAt: null,
      item: { codeValueId: "7", label: "축산" },
      floorRate: { value: "90.000", unit: "percentage-points" },
      baseAmount: { amount: "2761700.00", currency: "KRW" },
      winRate: { value: "90.309", unit: "percentage-points" },
      secondRate: null,
      awardedBidRate: { value: "88.3020", unit: "percentage-points" },
      dayFloorRate: { value: "88.0350", unit: "percentage-points" },
      listCount: 17,
      belowDayFloorCount: 2,
      winnerSupplierPartyId: "9",
      supersedesAttemptId: null,
    }]);
    expect(response.meta).toEqual({
      sampleCount: 92,
      item: null,
      opened: "only",
      asOf: "2026-09-06T01:00:00Z",
      buildId: "501",
      sourceReleaseId: "0f5f5d3c-6a1b-4f2e-9c8d-1a2b3c4d5e6f",
      calcVersion: "mart-r1",
      computedAt: "2026-09-04T00:10:00Z",
      coverage: "unknown",
      regionScheme: "eat:auction-location-sigungu",
    });
  });

  test("표본을 좁힌 품목과 개찰 기준을 meta에 되돌려 표본 수의 코호트를 응답만으로 닫는다", () => {
    const withItem = toOrganizationAttemptsResponse({
      input: { ...input, itemCodeValueId: 7n }, query: { ...query, itemCodeValueId: 7n }, page: pageOf({ sampleCount: 20 }),
    });
    expect(withItem.meta.item).toBe("7");
    expect(withItem.meta.sampleCount).toBe(20);
    // `any`는 기준 시각 자체가 없으므로 null이고, 이어 읽기는 첫 페이지가 쓴 시각을 그대로 되돌린다.
    const anyAttempt = toOrganizationAttemptsResponse({
      input: { ...input, opened: "any" }, query: { ...query, openedAtOrBefore: null }, page: pageOf({}),
    });
    expect(anyAttempt.meta).toMatchObject({ opened: "any", asOf: null });
    const pinned = Temporal.Instant.from("2026-09-05T00:00:00Z");
    const continued = toOrganizationAttemptsResponse({
      input: { ...input, expectedBuildId: 501n, asOf: pinned },
      query: { ...query, expectedBuildId: 501n, openedAtOrBefore: pinned },
      page: pageOf({}),
    });
    expect(continued.meta.asOf).toBe("2026-09-05T00:00:00Z");
  });

  test("활성 build가 없으면 계보 전체가 null인 빈 목록이다", () => {
    const response = toOrganizationAttemptsResponse({ input, query, page: pageOf({ attempts: [], sampleCount: 0, lineage: null }) });
    expect(organizationAuctionAttemptsV1ResponseSchema.parse(response)).toEqual(response);
    expect(response.attempts).toEqual([]);
    expect(response.meta).toEqual({
      sampleCount: 0,
      item: null,
      opened: "only",
      asOf: "2026-09-06T01:00:00Z",
      buildId: null,
      sourceReleaseId: null,
      calcVersion: null,
      computedAt: null,
      coverage: null,
      regionScheme: null,
    });
  });

  test("revision과 품목 라벨은 요청한 조회에만 실리고 기본 조회 응답에는 자리가 없다", () => {
    const withoutRevision = toOrganizationAttemptsResponse({ input, query, page: pageOf({}) });
    // 값이 없으면 JSON 경계에서 key 자체가 사라진다. 구 소비자의 strict parse가 이 위에 서 있다.
    expect(withoutRevision.attempts[0]?.revisionId).toBeUndefined();
    expect(JSON.parse(JSON.stringify(withoutRevision.attempts[0]))).not.toHaveProperty("revisionId");
    expect(JSON.parse(JSON.stringify(withoutRevision.attempts[0]))).not.toHaveProperty("itemLabel");
    const withRevision = toOrganizationAttemptsResponse({
      input: { ...input, includeRevision: true, includeItemLabel: true }, query, page: pageOf({}),
    });
    // mart 요약이 요약한 그 해석이며 최신 revision을 다시 고른 값이 아니다.
    expect(withRevision.attempts[0]?.revisionId).toBe("208");
    expect(withRevision.attempts[0]?.itemLabel).toBe("축산");
  });

  test("명시한 코호트 조건만 meta.cohort와 회차의 낙찰방식으로 되돌리고 없으면 자리를 만들지 않는다", () => {
    const plain = toOrganizationAttemptsResponse({ input, query, page: pageOf({}) });
    expect(JSON.parse(JSON.stringify(plain.meta))).not.toHaveProperty("cohort");
    expect(JSON.parse(JSON.stringify(plain.attempts[0]))).not.toHaveProperty("awardMethodCodeValueId");

    const period = { from: kstMonth("2026-08"), to: kstMonth("2026-09") };
    const cohort = toOrganizationAttemptsResponse({
      input: { ...input, floorRate: bidRate(canonicalDecimal("90.000", 3)), awardMethodCodeValueId: 31n, period },
      query: { ...query, floorRate: bidRate(canonicalDecimal("90.000", 3)), awardMethodCodeValueId: 31n },
      page: pageOf({ attempts: [{ ...record, awardMethodCodeValueId: 31n }] }),
    });
    expect(organizationAuctionAttemptsV1ResponseSchema.parse(cohort)).toEqual(cohort);
    expect(cohort.meta.cohort).toEqual({
      floorRate: { kind: "exact", value: { value: "90.000", unit: "percentage-points" } },
      awardMethod: { kind: "exact", codeValueId: "31" },
      period: { from: "2026-08", to: "2026-09" },
    });
    expect(cohort.attempts[0]?.awardMethodCodeValueId).toBe("31");
    // unknown은 "그 축이 관측되지 않은 회차만"이라는 명시 조건이며 all과 다르게 되돌린다.
    const unknownAxis = toOrganizationAttemptsResponse({
      input: { ...input, floorRate: "unknown" }, query: { ...query, floorRate: "unknown" }, page: pageOf({}),
    });
    expect(unknownAxis.meta.cohort).toEqual({ floorRate: { kind: "unknown" }, awardMethod: { kind: "all" }, period: null });
  });
});
