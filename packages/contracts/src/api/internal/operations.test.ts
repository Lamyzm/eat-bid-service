import { describe, expect, test } from "bun:test";
import { z } from "zod";

import { martNameSchema } from "../../values/cache-tag";
import { defineOperation } from "../operation";
import { publicHttpOperationRegistry } from "../registry";
import { internalHttpOperationRegistry, internalOperations } from "./operations";
import { REVALIDATE_AUCTION_ID_LIMIT, revalidateWebCacheBodySchema } from "./revalidate-web-cache";

const operation = internalOperations.revalidateWebCache;

describe("web 소유 캐시 무효화 operation", () => {
  test("web이 소유하는 non-/api 경로 하나다", () => {
    expect(operation.implementationOwner).toBe("web");
    expect(operation.method).toBe("post");
    expect(operation.path).toBe("/internal/cache/revalidate");
    expect(operation.versioning).toEqual({ kind: "neutral" });
  });

  test("/api prefix로는 web 소유 operation을 정의할 수 없다", () => {
    expect(() =>
      defineOperation({
        method: "post",
        versioning: { kind: "uri", prefix: "api", version: "1" },
        route: { resource: "cache", segments: ["revalidate"] },
        operationId: "revalidateWebCacheOnApi",
        implementationOwner: "web",
        summary: "금지된 조합",
        tags: ["internal"],
        pathSchema: z.strictObject({}),
        querySchema: z.undefined(),
        bodySchema: z.undefined(),
        successResponses: { 204: { description: "무응답", schema: z.undefined() } },
        problemResponses: { 400: { description: "잘못된 요청", schema: z.undefined() } },
      })
    ).toThrow();
  });

  test("공개 OpenAPI registry에는 들어가지 않는다", () => {
    const publicIds = publicHttpOperationRegistry.map((entry) => entry.operationId);
    expect(publicIds).not.toContain("revalidateWebCache");
    expect(internalHttpOperationRegistry.map((entry) => entry.operationId))
      .toEqual(["revalidateWebCache"]);
  });

  test("성공은 본문 없는 204이고 실패는 400·401·500 Problem이다", () => {
    expect(operation.successStatuses).toEqual([204]);
    expect(operation.problemStatuses).toEqual([400, 401, 500]);
  });
});

describe("캐시 무효화 요청 본문", () => {
  test("mart 이름은 계약 어휘의 셋만 받는다", () => {
    const parsed = revalidateWebCacheBodySchema.parse({ marts: ["org_round_summary"] });
    expect(parsed.marts).toEqual(["org_round_summary"]);
    expect(() => revalidateWebCacheBodySchema.parse({ marts: ["org_supplier_summary"] })).toThrow();
    expect(martNameSchema.options.length).toBe(3);
  });

  test("범위가 하나도 없는 요청은 거부한다", () => {
    expect(() => revalidateWebCacheBodySchema.parse({})).toThrow();
    expect(() => revalidateWebCacheBodySchema.parse({ allAuctions: false })).toThrow();
    expect(revalidateWebCacheBodySchema.parse({ allAuctions: true }).allAuctions).toBe(true);
  });

  test("공고 목록은 숫자 식별자이며 상한이 있다", () => {
    expect(revalidateWebCacheBodySchema.parse({ auctionIds: ["5796468"] }).auctionIds)
      .toEqual(["5796468"]);
    expect(() => revalidateWebCacheBodySchema.parse({ auctionIds: ["창원 남산초"] })).toThrow();
    const tooMany = Array.from({ length: REVALIDATE_AUCTION_ID_LIMIT + 1 }, (_, index) => String(index + 1));
    expect(() => revalidateWebCacheBodySchema.parse({ auctionIds: tooMany })).toThrow();
  });

  test("계약에 없는 key는 조용히 무시하지 않는다", () => {
    expect(() => revalidateWebCacheBodySchema.parse({ allAuctions: true, tags: ["mart:x"] }))
      .toThrow();
  });
});
