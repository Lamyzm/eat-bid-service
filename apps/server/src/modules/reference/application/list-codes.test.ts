import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { CodeReader, CodeReleaseListing, RegionCodeRecord } from "./code-reader";
import {
  CodeDependencyUnavailable,
  CodeReleaseNotFound,
  ListCodes,
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
  test("활성 release의 listing을 wire로 바꾸지 않고 그대로 돌려준다", async () => {
    const active = listing([codeRecord()]);
    const listCodes = new ListCodes(readerDouble({ readActiveRelease: async () => active }));
    // 직렬화는 presenter의 일이다. use case 결과에 십진 문자열이 섞이면 경계가 무너진 것이다.
    expect(await Effect.runPromise(listCodes.execute({ scheme: SCHEME, grain: null }))).toBe(active);
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
