import { describe, expect, test } from "bun:test";
import { z } from "zod";

import { problemDetailsSchema } from "../common/problem-details";
import { auctionV1Operations } from "./v1/auctions/operations";
import { healthOperations } from "../operations/health";
import {
  createOperationRegistry,
  defineOperation,
  pathParameter,
} from "./operation";

const sampleSuccessSchema = z.strictObject({ ok: z.literal(true) });
const noInputSchema = z.undefined();

function sampleOperation(operationId = "sampleFind") {
  return defineOperation({
    method: "get",
    versioning: { kind: "uri", prefix: "api", version: "2" },
    route: {
      resource: "schools",
      segments: [pathParameter("schoolCode")],
    },
    operationId,
    implementationOwner: "server",
    summary: "학교를 조회한다",
    tags: ["school"],
    pathSchema: z.strictObject({ schoolCode: z.string().min(1) }),
    querySchema: z.strictObject({ keyword: z.string().optional() }),
    bodySchema: noInputSchema,
    successResponses: {
      200: { description: "학교 조회 성공", schema: sampleSuccessSchema },
    },
    problemResponses: {
      404: { description: "학교를 찾을 수 없음", schema: problemDetailsSchema },
    },
  });
}

describe("공개 HTTP operation descriptor", () => {
  test("semantic route에서 Nest·OpenAPI·Web 경로를 함께 파생한다", () => {
    const operation = sampleOperation();

    expect(operation).toMatchObject({
      method: "get",
      versioning: { kind: "uri", prefix: "api", version: "2" },
      controllerPath: "schools",
      handlerPath: ":schoolCode",
      version: "2",
      openApiPath: "/api/v2/schools/{schoolCode}",
      path: "/api/v2/schools/{schoolCode}",
      operationId: "sampleFind",
      implementationOwner: "server",
      problemStatuses: [404],
      successStatuses: [200],
    });
    expect(operation.successResponses[200]?.schema).toBe(sampleSuccessSchema);
    expect(operation.problemResponses[404]?.schema).toBe(problemDetailsSchema);
    expect(Object.isFrozen(operation)).toBe(true);
    expect(Object.isFrozen(operation.versioning)).toBe(true);
    expect(Object.isFrozen(operation.route)).toBe(true);
    expect(Object.isFrozen(operation.route.segments)).toBe(true);
    expect(Object.isFrozen(operation.successResponses)).toBe(true);
    expect(Object.isFrozen(operation.problemResponses)).toBe(true);
  });

  test("path와 query를 먼저 검증하고 동적 값을 정확히 한 번 인코딩한다", () => {
    const operation = sampleOperation();

    expect(operation.buildPath({
      path: { schoolCode: "서울/학교%2F" },
      query: { keyword: "급식 공고" },
    })).toBe("/api/v2/schools/%EC%84%9C%EC%9A%B8%2F%ED%95%99%EA%B5%90%252F?keyword=%EA%B8%89%EC%8B%9D+%EA%B3%B5%EA%B3%A0");
    expect(() => operation.buildPath({ path: { schoolCode: "" }, query: {} })).toThrow();
    expect(() => operation.buildPath({
      path: { schoolCode: "학교" },
      query: {},
      origin: "https://example.com",
    } as never)).toThrow("origin");
  });

  test("공고 ID는 signed bigint 범위를 보존하고 비정규 값은 경로 생성 전에 거부한다", () => {
    expect(auctionV1Operations.find.buildPath({
      path: { auctionId: "9223372036854775807" },
    })).toBe("/api/v1/auctions/9223372036854775807");

    for (const auctionId of ["0", "01", "-1", "1.5", "9223372036854775808"]) {
      expect(() => auctionV1Operations.find.buildPath({ path: { auctionId } }), auctionId).toThrow();
    }
  });

  test("operation ID와 method·OpenAPI path 중복을 각각 거부한다", () => {
    const first = sampleOperation("sameId");
    const sameId = sampleOperation("sameId");
    const sameRoute = sampleOperation("differentId");

    expect(() => createOperationRegistry([first, sameId])).toThrow("operationId");
    expect(() => createOperationRegistry([first, sameRoute])).toThrow("method+path");
  });

  test("health operation은 비버전 경로와 status별 계약을 명시한다", () => {
    expect(healthOperations.live).toMatchObject({
      versioning: { kind: "neutral" },
      version: null,
      openApiPath: "/health/live",
      path: "/health/live",
      successStatuses: [200],
      problemStatuses: [500],
      implementationOwner: "server",
    });
    expect(healthOperations.ready.buildPath({ path: undefined })).toBe("/health/ready");
  });
});
