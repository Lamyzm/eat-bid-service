import { describe, expect, test } from "bun:test";

import { regionCodeV1Schema } from "./region-code";

const 종로구 = {
  codeValueId: "42",
  scheme: "mois:administrative-region",
  code: "1111000000",
  label: "서울특별시 종로구",
  parentCodeValueId: "7",
  active: true,
  validFrom: null,
  validTo: null,
  coordinate: null,
} as const;

describe("공개 지역 코드 값", () => {
  test("숫자 id를 1급으로 가지며 좌표는 없을 수 있다", () => {
    const parsed = regionCodeV1Schema.parse(종로구);
    expect(parsed.codeValueId).toBe("42");
    expect(parsed.coordinate).toBeNull();
  });

  test("code는 선행 0과 원본 자릿수를 그대로 보존한다", () => {
    expect(regionCodeV1Schema.parse({ ...종로구, code: "0111000000" }).code).toBe("0111000000");
  });

  test("상위 코드는 문자열이 아니라 숫자 id이며 없을 수 있다", () => {
    expect(regionCodeV1Schema.parse({ ...종로구, parentCodeValueId: null }).parentCodeValueId).toBeNull();
    expect(() => regionCodeV1Schema.parse({ ...종로구, parentCodeValueId: "1100000000 서울특별시" })).toThrow();
  });

  test("좌표는 CRS를 동반해야 하고 위경도만으로는 실릴 수 없다", () => {
    const 좌표 = { latitude: 37.5735, longitude: 126.979, crs: "EPSG:4326" } as const;
    expect(regionCodeV1Schema.parse({ ...종로구, coordinate: 좌표 }).coordinate).toEqual(좌표);
    expect(() => regionCodeV1Schema.parse({ ...종로구, coordinate: { latitude: 37.5735, longitude: 126.979 } })).toThrow();
  });

  test("유효기간이 없다는 사실은 null로 실리고 빈 문자열로 흐려지지 않는다", () => {
    expect(regionCodeV1Schema.parse(종로구).validFrom).toBeNull();
    expect(() => regionCodeV1Schema.parse({ ...종로구, validFrom: "" })).toThrow();
  });

  test("계약에 없는 열을 붙여 지역 어휘를 늘리지 못한다", () => {
    expect(() => regionCodeV1Schema.parse({ ...종로구, sidoName: "서울특별시" })).toThrow();
  });
});
