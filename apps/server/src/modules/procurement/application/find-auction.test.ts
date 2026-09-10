import { describe, expect, test } from "bun:test";
import { canonicalDecimal, krw, Temporal } from "@eatbid/domain";
import { EffectRunner } from "../../../platform/effect/effect-runner";

const auction = {
  auctionId: 9_007_199_254_740_993n,
  revisionId: 9_007_199_254_740_995n,
  title: "Fresh produce supply",
  status: "OPEN",
  displayBidNumber: null,
  announcedAt: Temporal.Instant.from("2026-08-30T00:00:00.123456789Z"),
  deadlineAt: null,
  openedAt: null,
  baseAmount: krw(canonicalDecimal("1234567890.50", 2)),
  plannedAmount: null,
  organization: { organizationId: 7n, name: "서울특별시교육청", type: "education-office" },
  terms: {
    floorRate: "90.000",
    awardMethod: { codeValueId: 31n, code: "003", scheme: "eat:award-method", label: "적격심사" },
  },
  location: {
    sido: { codeValueId: 41n, code: "48", scheme: "eat:auction-location-sido", label: "경상남도" },
    sigungu: null,
  },
  classification: { itemLabel: "축산" },
  participation: {
    latest: { bidCount: 4, observedAt: Temporal.Instant.from("2026-09-03T01:30:00Z") },
    dayEarlier: { bidCount: 2, observedAt: Temporal.Instant.from("2026-09-02T01:00:00Z") },
  },
  provenance: {
    sourceSystem: "eat",
    externalBidId: "external-opaque-id",
    observationId: 9_007_199_254_740_997n,
    normalizedRecordId: 9_007_199_254_740_999n,
    contentSha256: "a".repeat(64),
  },
} as const;

describe("FindAuction 조회 use case", () => {
  test("bigint·Temporal·Money를 중첩 V1 응답으로 무손실 encode한다", async () => {
    const application = await import("./find-auction").catch(() => undefined);
    expect(application, "FindAuction use case must exist").toBeDefined();
    const useCase = new application!.FindAuction({ findById: async () => auction });
    await expect(new EffectRunner().run(useCase.execute({ auctionId: auction.auctionId }))).resolves.toEqual({
      identity: {
        auctionId: "9007199254740993",
        revisionId: "9007199254740995",
        externalBidId: "external-opaque-id",
        displayBidNumber: null,
        title: "Fresh produce supply",
        status: "OPEN",
      },
      organization: { organizationId: "7", name: "서울특별시교육청", type: "education-office" },
      schedule: {
        announcedAt: "2026-08-30T00:00:00.123456789Z",
        deadlineAt: null,
        openedAt: null,
      },
      pricing: {
        baseAmount: { amount: "1234567890.50", currency: "KRW" },
        plannedAmount: null,
      },
      provenance: {
        sourceSystem: "eat",
        observationId: "9007199254740997",
        normalizedRecordId: "9007199254740999",
        contentSha256: "a".repeat(64),
      },
      // 코드 참조의 숫자 id도 bigint라 십진 문자열로만 나간다. 하한율은 사정률 축의 wire 봉투를 쓴다.
      terms: {
        floorRate: { value: "90.000", unit: "percentage-points" },
        awardMethod: { codeValueId: "31", code: "003", scheme: "eat:award-method", label: "적격심사" },
      },
      location: {
        sido: { codeValueId: "41", code: "48", scheme: "eat:auction-location-sido", label: "경상남도" },
        sigungu: null,
      },
      classification: { itemLabel: "축산" },
      // 참여 수는 관측 시각과 짝지어 나간다. 시각 없는 참여 수는 추정으로 읽힌다.
      participation: {
        latest: { bidCount: 4, observedAt: "2026-09-03T01:30:00Z" },
        dayEarlier: { bidCount: 2, observedAt: "2026-09-02T01:00:00Z" },
      },
    });
  });

  test("typed not-found와 의존성 실패를 구분하고 공고 실패는 모듈 공통 실패의 하위형이다", async () => {
    const application = await import("./find-auction").catch(() => undefined);
    expect(application, "FindAuction use case must exist").toBeDefined();
    const { ProcurementDependencyUnavailable } = await import("./failures");
    // controller가 모듈 공통 실패로 잡아도 같은 503이어야 자원 이름 실패가 새 분기를 강요하지 않는다.
    expect(new application!.AuctionDependencyUnavailable(new Error("offline")))
      .toBeInstanceOf(ProcurementDependencyUnavailable);
    const runner = new EffectRunner();
    const missing = new application!.FindAuction({ findById: async () => null });
    await expect(runner.run(missing.execute({ auctionId: 41n }))).rejects.toMatchObject({
      name: "AuctionNotFound",
      code: "AUCTION_NOT_FOUND",
      auctionId: 41n,
    });
    const unavailable = new application!.FindAuction({
      findById: async () => { throw new Error("credential=must-not-escape"); },
    });
    await expect(runner.run(unavailable.execute({ auctionId: 41n }))).rejects.toMatchObject({
      name: "AuctionDependencyUnavailable",
      code: "DEPENDENCY_UNAVAILABLE",
    });
  });
});
