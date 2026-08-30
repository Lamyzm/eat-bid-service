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
