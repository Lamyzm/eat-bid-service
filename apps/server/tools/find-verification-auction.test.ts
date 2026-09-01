import { describe, expect, test } from "bun:test";

import { selectVerificationAuction } from "./find-verification-auction";

describe("실제 dev 공고 검증 ID 선택", () => {
  test("최신 조회 행의 큰 auction과 revision ID를 문자열로 보존한다", () => {
    expect(
      selectVerificationAuction([
        {
          auction_id: "9007199254740993",
          revision_id: 9007199254740995n,
        },
      ]),
    ).toEqual({
      auctionId: "9007199254740993",
      revisionId: "9007199254740995",
    });
  });

  test("검증할 canonical 공고가 없으면 명시적으로 실패한다", () => {
    expect(() => selectVerificationAuction([])).toThrow("검증할 canonical 공고가 없습니다.");
  });

  test("양의 PostgreSQL bigint 범위 밖의 ID를 출력하지 않는다", () => {
    for (const row of [
      { auction_id: "0", revision_id: "1" },
      { auction_id: "1", revision_id: "9223372036854775808" },
    ]) {
      expect(() => selectVerificationAuction([row])).toThrow();
    }
  });
});
