import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { GetAuctionRoster } from "./get-auction-roster";
import { AuctionNotFound, AuctionDependencyUnavailable } from "./find-auction";
import { auctionId } from "../domain/auction-id";

describe("회차 명단 use case", () => {
  test("없는 revision은 공고 없음으로 전달한다", async () => {
    const useCase = new GetAuctionRoster({ find: async () => null });
    await expect(Effect.runPromise(useCase.execute({ auctionId: auctionId(9n), revisionId: 99n })))
      .rejects.toBeInstanceOf(AuctionNotFound);
  });
  test("조회 장애는 정상적인 빈 명단으로 바꾸지 않는다", async () => {
    const useCase = new GetAuctionRoster({ find: async () => { throw new Error("offline"); } });
    await expect(Effect.runPromise(useCase.execute({ auctionId: auctionId(9n), revisionId: null })))
      .rejects.toBeInstanceOf(AuctionDependencyUnavailable);
  });
});
