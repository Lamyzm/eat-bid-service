import { describe, expect, test } from "bun:test";

import { publicHttpOperationRegistry } from "../../registry";
import { codeSchemeV1Operations } from "./operations";
import { listCodesV1ResponseSchema } from "./list-codes.response";

const listCodes = codeSchemeV1Operations.listCodes;

describe("listCodes operation 계약", () => {
  test("공개 registry가 이 operation을 한 번만 갖는다", () => {
    const found = publicHttpOperationRegistry.filter((operation) => operation.operationId === "listCodes");
    expect(found.length).toBe(1);
    expect(found[0]?.implementationOwner).toBe("server");
  });

  test("semantic route에서 versioned 경로가 파생된다", () => {
    expect(listCodes.method).toBe("get");
    expect(listCodes.openApiPath).toBe("/api/v1/code-schemes/{scheme}/codes");
    expect(listCodes.buildPath({ path: { scheme: "mois:administrative-region" } }))
      .toBe("/api/v1/code-schemes/mois%3Aadministrative-region/codes");
  });

  test("grain query는 값 목록을 열거하지 않고 선택적이다", () => {
    expect(listCodes.querySchema.parse(undefined)).toEqual({});
    expect(listCodes.querySchema.parse({ grain: "sigungu" })).toEqual({ grain: "sigungu" });
  });

  test("알 수 없는 체계와 활성 release 부재는 404 Problem이다", () => {
    expect(listCodes.problemStatuses).toEqual([400, 404, 500, 503]);
  });

  test("성공 응답은 목록과 release meta를 함께 싣는다", () => {
    const parsed = listCodesV1ResponseSchema.parse({
      scheme: "mois:administrative-region",
      codes: [],
      meta: {
        codeReleaseId: "1",
        sourceVersion: "2026-09-06",
        publishedAt: null,
        promotedGrain: ["sido", "sigungu"],
        codesWithoutCoordinateCount: 4,
      },
    });
    expect(parsed.meta.codesWithoutCoordinateCount).toBe(4);
    expect(listCodes.successStatuses).toEqual([200]);
  });
});
