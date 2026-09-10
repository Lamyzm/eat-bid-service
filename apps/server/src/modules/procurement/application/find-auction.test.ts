import { describe, expect, test } from "bun:test";
import { canonicalDecimal, krw, Temporal } from "@eatbid/domain";
import { EffectRunner } from "../../../platform/effect/effect-runner";
import type { AuctionRecord } from "./auction-reader";
import { auctionId } from "../domain/auction-id";

const auction: AuctionRecord = {
  auctionId: auctionId(9_007_199_254_740_993n),
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
  terms: null,
  location: null,
  classification: null,
  participation: null,
  provenance: {
    sourceSystem: "eat",
    externalBidId: "external-opaque-id",
    observationId: 9_007_199_254_740_997n,
    normalizedRecordId: 9_007_199_254_740_999n,
    contentSha256: "a".repeat(64),
  },
};

describe("FindAuction 조회 use case", () => {
  test("reader가 돌려준 내부 record를 wire로 바꾸지 않고 그대로 돌려준다", async () => {
    const application = await import("./find-auction").catch(() => undefined);
    expect(application, "FindAuction use case must exist").toBeDefined();
    const useCase = new application!.FindAuction({ findById: async () => auction });
    // 직렬화는 presenter의 일이다. use case 결과에 십진 문자열이나 wire 봉투가 섞이면 경계가 무너진 것이다.
    await expect(new EffectRunner().run(useCase.execute({ auctionId: auction.auctionId }))).resolves.toBe(auction);
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
    await expect(runner.run(missing.execute({ auctionId: auctionId(41n) }))).rejects.toMatchObject({
      name: "AuctionNotFound",
      code: "AUCTION_NOT_FOUND",
      auctionId: 41n,
    });
    const unavailable = new application!.FindAuction({
      findById: async () => { throw new Error("credential=must-not-escape"); },
    });
    await expect(runner.run(unavailable.execute({ auctionId: auctionId(41n) }))).rejects.toMatchObject({
      name: "AuctionDependencyUnavailable",
      code: "DEPENDENCY_UNAVAILABLE",
    });
  });
});
