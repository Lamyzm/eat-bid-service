import { describe, expect, test } from "bun:test";
import { EffectRunner } from "../../../platform/effect/effect-runner";

const auction = {
  auctionId: 9_007_199_254_740_993n,
  revisionId: 9_007_199_254_740_995n,
  title: "Fresh produce supply",
  status: "OPEN",
  displayBidNumber: null,
  announcedAt: new Date("2026-08-30T00:00:00.000Z"),
  deadlineAt: null,
  openedAt: null,
  baseAmount: "1234567890.50",
  plannedAmount: null,
  currency: "KRW",
  provenance: {
    sourceSystem: "eat",
    externalBidId: "external-opaque-id",
    observationId: 9_007_199_254_740_997n,
    normalizedRecordId: 9_007_199_254_740_999n,
    contentSha256: "a".repeat(64),
  },
} as const;

describe("FindAuction 조회 use case", () => {
  test("bigint와 time을 무손실 매핑한 제한 view를 반환한다", async () => {
    const application = await import("./find-auction").catch(() => undefined);
    expect(application, "FindAuction use case must exist").toBeDefined();
    const useCase = new application!.FindAuction({ findById: async () => auction });
    await expect(new EffectRunner().run(useCase.execute({ auctionId: auction.auctionId }))).resolves.toEqual({
      auctionId: "9007199254740993",
      revisionId: "9007199254740995",
      title: "Fresh produce supply",
      status: "OPEN",
      displayBidNumber: null,
      announcedAt: "2026-08-30T00:00:00.000Z",
      deadlineAt: null,
      openedAt: null,
      baseAmount: "1234567890.50",
      plannedAmount: null,
      currency: "KRW",
      provenance: {
        sourceSystem: "eat",
        externalBidId: "external-opaque-id",
        observationId: "9007199254740997",
        normalizedRecordId: "9007199254740999",
        contentSha256: "a".repeat(64),
      },
    });
  });

  test("typed not-found와 의존성 실패를 구분한다", async () => {
    const application = await import("./find-auction").catch(() => undefined);
    expect(application, "FindAuction use case must exist").toBeDefined();
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
