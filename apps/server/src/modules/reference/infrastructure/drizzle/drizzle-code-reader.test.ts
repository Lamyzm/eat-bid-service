import { describe, expect, test } from "bun:test";
import type { SQL } from "drizzle-orm";
import { DrizzleCodeReader, mapMemberRow } from "./drizzle-code-reader";

function memberRow(overrides: Record<string, unknown> = {}) {
  return {
    code_value_id: "1101",
    code: "1100000000",
    label: "서울특별시",
    parent_code_value_id: null,
    grain: "sido",
    active: true,
    valid_from: null,
    valid_to: null,
    latitude: "37.566500",
    longitude: "126.978000",
    crs: "EPSG:4326",
    ...overrides,
  } as Parameters<typeof mapMemberRow>[0];
}

function fakeDatabase(responses: readonly unknown[]): { execute(query: SQL): Promise<unknown>; queries: string[] } {
  const queries: string[] = [];
  let index = 0;
  return {
    queries,
    async execute(query: SQL): Promise<unknown> {
      queries.push(JSON.stringify(query.queryChunks?.length ?? 0));
      const response = responses[index] ?? [];
      index += 1;
      return response;
    },
  };
}

describe("DrizzleCodeReader row 경계", () => {
  test("numeric 좌표 문자열과 bigint 식별자를 application record로 닫는다", () => {
    expect(mapMemberRow(memberRow({ parent_code_value_id: "1100" }))).toEqual({
      codeValueId: 1101n,
      code: "1100000000",
      label: "서울특별시",
      parentCodeValueId: 1100n,
      grain: "sido",
      active: true,
      validFrom: null,
      validTo: null,
      coordinate: { latitude: 37.5665, longitude: 126.978, crs: "EPSG:4326" },
    });
  });

  test("좌표가 없는 member는 결측 그대로 두고 모구 좌표로 메우지 않는다", () => {
    const record = mapMemberRow(memberRow({ latitude: null, longitude: null, crs: null }));
    expect(record.coordinate).toBeNull();
  });

  test("라벨을 관측하지 못한 member는 코드 문자열로 메우지 않고 끊는다", () => {
    expect(() => mapMemberRow(memberRow({ label: null }))).toThrow(TypeError);
    expect(() => mapMemberRow(memberRow({ label: "   " }))).toThrow(TypeError);
  });

  test("허용되지 않은 좌표계나 지구 밖 좌표는 조용히 싣지 않는다", () => {
    expect(() => mapMemberRow(memberRow({ crs: "EPSG:5179" }))).toThrow(TypeError);
    expect(() => mapMemberRow(memberRow({ latitude: "97.000000" }))).toThrow(TypeError);
    expect(() => mapMemberRow(memberRow({ longitude: "1126.978000" }))).toThrow(TypeError);
  });
});

describe("DrizzleCodeReader 활성 release 조회", () => {
  test("체계에 release가 하나도 없으면 빈 목록이 아니라 없음으로 답한다", async () => {
    const database = fakeDatabase([[]]);
    const reader = new DrizzleCodeReader(database);
    expect(await reader.readActiveRelease({ scheme: "eat:unknown-scheme", grain: null })).toBeNull();
    // release가 없으면 member 조회로 내려가지 않는다.
    expect(database.queries.length).toBe(1);
  });

  test("가장 나중에 봉인된 release의 member와 그 release의 좌표를 함께 돌려준다", async () => {
    const database = fakeDatabase([
      [{
        code_release_id: "7",
        source_version: "2026-09-06",
        published_at: null,
        promoted_grain: ["sido", "sigungu"],
      }],
      [memberRow(), memberRow({
        code_value_id: "1102",
        code: "1111000000",
        label: "종로구",
        parent_code_value_id: "1101",
        grain: "sigungu",
        latitude: null,
        longitude: null,
        crs: null,
      })],
    ]);
    const listing = await new DrizzleCodeReader(database).readActiveRelease({
      scheme: "mois:administrative-region",
      grain: null,
    });
    expect(listing?.release).toEqual({
      codeReleaseId: 7n,
      sourceVersion: "2026-09-06",
      publishedAt: null,
      promotedGrain: ["sido", "sigungu"],
    });
    expect(listing?.codes.map((code) => code.code)).toEqual(["1100000000", "1111000000"]);
    expect(listing?.codes[1]?.coordinate).toBeNull();
  });
});
