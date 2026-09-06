import { describe, expect, test } from "bun:test";
import { listCodesV1ResponseSchema } from "@eatbid/contracts";
import { Temporal } from "@eatbid/domain";
import { Effect } from "effect";
import type { CodeReader, CodeReleaseListing, RegionCodeRecord } from "./code-reader";
import {
  CodeDependencyUnavailable,
  CodeReleaseNotFound,
  ListCodes,
  toListCodesResponse,
} from "./list-codes";

const SCHEME = "mois:administrative-region";

function codeRecord(overrides: Partial<RegionCodeRecord> = {}): RegionCodeRecord {
  return {
    codeValueId: 1101n,
    code: "1100000000",
    label: "서울특별시",
    parentCodeValueId: null,
    grain: "sido",
    active: true,
    validFrom: null,
    validTo: null,
    coordinate: { latitude: 37.5665, longitude: 126.978, crs: "EPSG:4326" },
    ...overrides,
  };
}

function listing(codes: readonly RegionCodeRecord[]): CodeReleaseListing {
  return {
    release: {
      codeReleaseId: 7n,
      sourceVersion: "2026-09-06",
      publishedAt: null,
      promotedGrain: ["sido", "sigungu"],
    },
    codes,
  };
}

function readerDouble(overrides: Partial<CodeReader> = {}): CodeReader {
  return { readActiveRelease: async () => listing([codeRecord()]), ...overrides };
}

describe("코드 목록 조회 use case", () => {
  test("release meta와 코드 행을 공개 V1 응답 계약으로 직렬화한다", () => {
    const response = toListCodesResponse(SCHEME, listing([
      codeRecord(),
      codeRecord({
        codeValueId: 1102n,
        code: "1111000000",
        label: "종로구",
        parentCodeValueId: 1101n,
        grain: "sigungu",
        coordinate: null,
      }),
    ]));
    expect(listCodesV1ResponseSchema.parse(response)).toEqual(response);
    expect(response.codes[0]).toEqual({
      codeValueId: "1101",
      scheme: SCHEME,
      code: "1100000000",
      label: "서울특별시",
      parentCodeValueId: null,
      active: true,
      validFrom: null,
      validTo: null,
      coordinate: { latitude: 37.5665, longitude: 126.978, crs: "EPSG:4326" },
    });
    expect(response.codes[1]?.parentCodeValueId).toBe("1101");
    expect(response.meta).toEqual({
      codeReleaseId: "7",
      sourceVersion: "2026-09-06",
      publishedAt: null,
      promotedGrain: ["sido", "sigungu"],
      codesWithoutCoordinateCount: 1,
    });
  });

  test("원본이 준 유효기간만 canonical instant 문자열로 싣고 없으면 null로 남긴다", () => {
    const response = toListCodesResponse(SCHEME, listing([
      codeRecord({
        validFrom: Temporal.Instant.from("2026-07-01T00:00:00Z"),
        validTo: null,
        active: false,
      }),
    ]));
    expect(response.codes[0]?.validFrom).toBe("2026-07-01T00:00:00Z");
    expect(response.codes[0]?.validTo).toBeNull();
    expect(response.codes[0]?.active).toBe(false);
  });

  test("좌표 없는 코드 수를 숨기지 않고 meta가 센다", () => {
    const response = toListCodesResponse(SCHEME, listing([
      codeRecord({ coordinate: null }),
      codeRecord({ codeValueId: 1102n, code: "1111000000", coordinate: null }),
      codeRecord({ codeValueId: 1103n, code: "1114000000" }),
    ]));
    expect(response.meta.codesWithoutCoordinateCount).toBe(2);
  });

  test("활성 release가 없으면 빈 목록이 아니라 없음 실패다", async () => {
    const listCodes = new ListCodes(readerDouble({ readActiveRelease: async () => null }));
    const failure = await Effect.runPromise(
      Effect.flip(listCodes.execute({ scheme: "eat:unknown-scheme", grain: null })),
    );
    expect(failure).toBeInstanceOf(CodeReleaseNotFound);
    expect(failure.code).toBe("NOT_FOUND");
  });

  test("조회 장애는 없음이 아니라 의존성 장애로 분류된다", async () => {
    const listCodes = new ListCodes(readerDouble({
      readActiveRelease: async () => { throw new Error("connection refused"); },
    }));
    const failure = await Effect.runPromise(
      Effect.flip(listCodes.execute({ scheme: SCHEME, grain: null })),
    );
    expect(failure).toBeInstanceOf(CodeDependencyUnavailable);
    expect(failure.code).toBe("DEPENDENCY_UNAVAILABLE");
  });

  test("grain query를 그대로 port에 넘기고 값 목록을 use case가 판정하지 않는다", async () => {
    const observed: string[] = [];
    const listCodes = new ListCodes(readerDouble({
      readActiveRelease: async (query) => {
        observed.push(`${query.scheme}/${query.grain ?? "*"}`);
        return listing([codeRecord()]);
      },
    }));
    await Effect.runPromise(listCodes.execute({ scheme: SCHEME, grain: "sigungu" }));
    await Effect.runPromise(listCodes.execute({ scheme: SCHEME, grain: null }));
    expect(observed).toEqual([`${SCHEME}/sigungu`, `${SCHEME}/*`]);
  });
});
