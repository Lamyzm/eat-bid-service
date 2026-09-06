import { describe, expect, test } from "bun:test";

import {
  ALL_AUCTIONS_CACHE_TAG,
  auctionCacheTag,
  cacheTagSchema,
  martCacheTag,
  martNameSchema,
  organizationCacheTag,
} from "./cache-tag";

describe("읽기 캐시 태그 어휘", () => {
  test("mart 태그는 build id가 아니라 안정된 mart 이름으로 만든다", () => {
    expect(martCacheTag("org_round_summary")).toBe("mart:org_round_summary");
    expect(martCacheTag("win_rate_distribution_monthly")).toBe("mart:win_rate_distribution_monthly");
  });

  test("mart 이름은 dataplane이 아는 셋뿐이며 순서도 같다", () => {
    expect(martNameSchema.options).toEqual([
      "org_round_summary",
      "win_rate_distribution_monthly",
      "open_auction_snapshot",
    ]);
    expect(() => martCacheTag("org_supplier_summary" as never)).toThrow();
  });

  test("공고와 기관 태그는 숫자 id만 받는다", () => {
    expect(auctionCacheTag("5796468")).toBe("auction:5796468");
    expect(organizationCacheTag("3101")).toBe("org:3101");
    expect(() => auctionCacheTag("창원 남산초등학교")).toThrow();
    expect(() => organizationCacheTag("3101:extra")).toThrow();
    expect(() => auctionCacheTag("")).toThrow();
  });

  test("공고 전체 태그는 namespace 없는 상수 하나다", () => {
    expect(ALL_AUCTIONS_CACHE_TAG).toBe("allAuctions");
    expect(cacheTagSchema.parse(ALL_AUCTIONS_CACHE_TAG)).toBe("allAuctions");
  });

  test("태그 문자열은 namespace 하나와 값 하나까지만 허용한다", () => {
    expect(cacheTagSchema.parse("mart:org_round_summary")).toBe("mart:org_round_summary");
    expect(() => cacheTagSchema.parse("mart:build:12")).toThrow();
    expect(() => cacheTagSchema.parse("mart:")).toThrow();
    expect(() => cacheTagSchema.parse("공고:1")).toThrow();
  });
});
