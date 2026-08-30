import { describe, expect, test } from "bun:test";

import { latitude, longitude, wgs84 } from "./coordinate.js";

describe("WGS84 좌표", () => {
  test("검증한 위도와 경도에 고정 CRS를 붙인 불변 값을 만든다", () => {
    const coordinate = wgs84(latitude(37.5665), longitude(126.978));

    expect(coordinate).toEqual({ latitude: 37.5665, longitude: 126.978, crs: "EPSG:4326" });
    expect(Object.isFrozen(coordinate)).toBe(true);
  });

  test("위도의 닫힌 법정 범위를 검증한다", () => {
    expect(latitude(-90)).toBe(-90);
    expect(latitude(90)).toBe(90);
    for (const value of [-90.000001, 90.000001, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => latitude(value)).toThrow(RangeError);
    }
  });

  test("경도의 닫힌 법정 범위를 검증한다", () => {
    expect(longitude(-180)).toBe(-180);
    expect(longitude(180)).toBe(180);
    for (const value of [-180.000001, 180.000001, Number.NaN, Number.NEGATIVE_INFINITY]) {
      expect(() => longitude(value)).toThrow(RangeError);
    }
  });
});
