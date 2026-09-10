import { describe, expect, test } from "bun:test";
import { codeReferenceSchema, martBuildLineageSchema } from "@eatbid/contracts";
import { baseRelativeBidRate, bidRate, canonicalDecimal, observedBidRate, Temporal } from "@eatbid/domain";
import {
  baseRelativeBidRateWire,
  bidRateWire,
  bigintText,
  codeReferenceWire,
  instantText,
  martBuildLineageWire,
  observedBidRateWire,
} from "./wire";

describe("모듈 공통 wire 변환", () => {
  test("시각은 canonical UTC 문자열로, bigint는 십진 문자열로 닫고 null은 그대로 둔다", () => {
    expect(instantText(Temporal.Instant.from("2026-09-07T00:10:00.123456789Z"))).toBe("2026-09-07T00:10:00.123456789Z");
    expect(instantText(null)).toBeNull();
    // Number를 거치면 정밀도가 손실되는 값이다.
    expect(bigintText(9_007_199_254_740_993n)).toBe("9007199254740993");
    expect(bigintText(null)).toBeNull();
  });

  test("세 비율 축은 같은 percentage-points 봉투를 쓰되 값의 scale을 축마다 그대로 보존한다", () => {
    expect(bidRateWire(bidRate(canonicalDecimal("90.000", 3)))).toEqual({ value: "90.000", unit: "percentage-points" });
    expect(observedBidRateWire(observedBidRate(canonicalDecimal("100.001", 3)))).toEqual({ value: "100.001", unit: "percentage-points" });
    // 기초금액 분모 축은 넷째 자리까지 회차를 구분한다. 봉투가 그 자리를 반올림하지 않는다.
    expect(baseRelativeBidRateWire(baseRelativeBidRate(canonicalDecimal("88.0350", 4)))).toEqual({ value: "88.0350", unit: "percentage-points" });
    expect(bidRateWire(null)).toBeNull();
    expect(observedBidRateWire(null)).toBeNull();
    expect(baseRelativeBidRateWire(null)).toBeNull();
  });

  test("코드 참조는 네 필드만 wire로 옮기고 record에 늘어난 열은 strict 계약에 새지 않는다", () => {
    const record = { codeValueId: 41n, code: "48", scheme: "eat:auction-location-sido", label: "경상남도", extra: "leak" };
    const wire = codeReferenceWire(record);
    expect(wire).toEqual({ codeValueId: "41", code: "48", scheme: "eat:auction-location-sido", label: "경상남도" });
    expect(codeReferenceSchema.parse(wire)).toEqual(wire);
    expect(codeReferenceWire(null)).toBeNull();
  });

  test("mart 계보는 build 하나의 값을 그대로 싣고 활성 build가 없으면 전부 null이다", () => {
    const lineage = {
      buildId: 601n,
      sourceReleaseId: "0f5f5d3c-6a1b-4f2e-9c8d-1a2b3c4d5e6f",
      calcVersion: "mart-r2",
      computedAt: Temporal.Instant.from("2026-09-07T00:10:00Z"),
      coverage: "unknown" as const,
      regionScheme: "eat:auction-location-sigungu",
    };
    const wire = martBuildLineageWire(lineage);
    expect(martBuildLineageSchema.parse(wire)).toEqual(wire);
    expect(wire).toEqual({
      buildId: "601",
      sourceReleaseId: "0f5f5d3c-6a1b-4f2e-9c8d-1a2b3c4d5e6f",
      calcVersion: "mart-r2",
      computedAt: "2026-09-07T00:10:00Z",
      coverage: "unknown",
      regionScheme: "eat:auction-location-sigungu",
    });
    // 파생물이 아직 없는 것은 오류가 아니라 계보 전체가 null인 정상 상태다.
    expect(martBuildLineageWire(null)).toEqual({
      buildId: null, sourceReleaseId: null, calcVersion: null, computedAt: null, coverage: null, regionScheme: null,
    });
  });
});
