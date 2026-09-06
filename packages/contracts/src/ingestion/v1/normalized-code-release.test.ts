import { describe, expect, test } from "bun:test";

import {
  normalizedCodeReleaseMemberV1Schema,
  normalizedCodeReleaseV1Schema,
} from "./normalized-code-release";

const 종로구 = {
  scheme: "mois:administrative-region",
  code: "1111000000",
  label: "서울특별시 종로구",
  parentCode: "1100000000",
  active: true,
  validFrom: null,
  validTo: null,
} as const;

const release = {
  sourceSystem: "mois-standard-code",
  dataset: "legal-dong",
  scheme: "mois:administrative-region",
  sourceVersion: "2026-09-06",
  publishedAt: null,
  promotedGrain: ["sido", "sigungu"],
  sourceRowCount: 53387,
  excludedRowCount: 52850,
  members: [종로구],
} as const;

describe("정부 코드 release ingestion wire", () => {
  test("코드 member는 scheme과 선행 0을 함께 보존한다", () => {
    const member = normalizedCodeReleaseMemberV1Schema.parse(종로구);
    expect(member.code).toBe("1111000000");
    expect(member.scheme).toBe("mois:administrative-region");
  });

  test("폐지된 행은 삭제되지 않고 active false로 실린다", () => {
    expect(normalizedCodeReleaseMemberV1Schema.parse({ ...종로구, active: false }).active).toBe(false);
  });

  test("원본이 날짜를 주지 않으면 유효기간은 null이고 지어내지 않는다", () => {
    const member = normalizedCodeReleaseMemberV1Schema.parse(종로구);
    expect(member.validFrom).toBeNull();
    expect(member.validTo).toBeNull();
  });

  test("상위 코드는 없을 수 있다", () => {
    expect(normalizedCodeReleaseMemberV1Schema.parse({ ...종로구, parentCode: null }).parentCode).toBeNull();
  });

  test("release는 무엇을 승격하고 무엇을 뺐는지를 함께 싣는다", () => {
    const parsed = normalizedCodeReleaseV1Schema.parse(release);
    expect(parsed.promotedGrain).toEqual(["sido", "sigungu"]);
    expect(parsed.sourceRowCount).toBe(53387);
    expect(parsed.excludedRowCount).toBe(52850);
  });

  test("승격 grain을 비워 둔 release는 만들 수 없다", () => {
    expect(() => normalizedCodeReleaseV1Schema.parse({ ...release, promotedGrain: [] })).toThrow();
  });

  test("계약에 없는 열로 좌표를 코드 행에 밀어 넣지 못한다", () => {
    expect(() => normalizedCodeReleaseMemberV1Schema.parse({ ...종로구, latitude: 37.5 })).toThrow();
  });
});
