import { describe, expect, test } from "bun:test";
import { codeReferenceRecord, observedLabel } from "./postgres-row-values";

describe("PostgreSQL 행 라벨·코드 참조 규약", () => {
  test("공백뿐인 라벨은 관측되지 않은 것으로 남기고 양끝 공백만 다듬는다", () => {
    expect(observedLabel(null)).toBeNull();
    expect(observedLabel("")).toBeNull();
    expect(observedLabel("   ")).toBeNull();
    expect(observedLabel(" 창원 남산초등학교 ")).toBe("창원 남산초등학교");
  });

  test("코드 참조는 id·코드·체계가 모두 있어야 만들고 라벨에는 같은 규약을 적용한다", () => {
    expect(codeReferenceRecord("41", "48", "eat:auction-location-sido", " 경상남도 "))
      .toEqual({ codeValueId: 41n, code: "48", scheme: "eat:auction-location-sido", label: "경상남도" });
    expect(codeReferenceRecord(41n, "48", "eat:auction-location-sido", "  ")?.label).toBeNull();
    // 체계 없는 코드는 정체성이 아니다. 셋 중 하나라도 비면 참조 자체가 없다.
    expect(codeReferenceRecord(null, "48", "eat:auction-location-sido", "경상남도")).toBeNull();
    expect(codeReferenceRecord("41", null, "eat:auction-location-sido", "경상남도")).toBeNull();
    expect(codeReferenceRecord("41", "48", null, "경상남도")).toBeNull();
  });
});
