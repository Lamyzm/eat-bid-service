import { describe, expect, test } from "bun:test";

import {
  normalizedCodeVocabularyEntryV1Schema,
  normalizedCodeVocabularyV1Schema,
} from "./normalized-code-vocabulary";

const 경남 = {
  scheme: "eat:auction-location-sido",
  code: "15",
  label: "경남",
  active: true,
  validFrom: "1900-01-01T00:00:00Z",
  validTo: "9999-12-31T00:00:00Z",
  parent: null,
} as const;

const vocabulary = {
  sourceSystem: "eat",
  dataset: "ds_out",
  sourceRowCount: 282,
  excludedRowCount: 0,
  entries: [경남],
} as const;

describe("소스 코드목록 ingestion wire", () => {
  test("시군구 항목은 소스가 말한 상위 시도를 체계와 코드로 싣고 상위가 없는 항목은 null이다", () => {
    const 김해시 = normalizedCodeVocabularyEntryV1Schema.parse({
      ...경남,
      scheme: "eat:auction-location-sigungu",
      code: "653",
      label: "김해시",
      parent: { scheme: "eat:auction-location-sido", code: "15" },
    });
    expect(김해시.parent).toEqual({ scheme: "eat:auction-location-sido", code: "15" });
    expect(normalizedCodeVocabularyEntryV1Schema.parse(경남).parent).toBeNull();
    // 상위는 체계 없이 코드만으로 말할 수 없다. 코드 문자열은 체계 안에서만 뜻이 있다(AGENTS 2·6).
    expect(normalizedCodeVocabularyEntryV1Schema.safeParse({ ...경남, parent: { code: "15" } }).success).toBe(false);
  });

  test("어휘 항목은 체계와 선행 0을 함께 보존한다", () => {
    const entry = normalizedCodeVocabularyEntryV1Schema.parse({ ...경남, code: "001" });
    expect(entry.code).toBe("001");
    expect(entry.scheme).toBe("eat:auction-location-sido");
  });

  test("소스가 그만 쓴다고 말한 코드도 이름을 잃지 않고 active만 내린다", () => {
    const entry = normalizedCodeVocabularyEntryV1Schema.parse({ ...경남, active: false });
    expect(entry.active).toBe(false);
    expect(entry.label).toBe("경남");
  });

  test("유효기간을 주지 않은 소스는 null로 남고 관측 시각으로 메워지지 않는다", () => {
    const entry = normalizedCodeVocabularyEntryV1Schema.parse({
      ...경남,
      validFrom: null,
      validTo: null,
    });
    expect(entry.validFrom).toBeNull();
    expect(entry.validTo).toBeNull();
  });

  test("이름이 빈 관측은 어휘 항목이 되지 못한다", () => {
    expect(normalizedCodeVocabularyEntryV1Schema.safeParse({ ...경남, label: "" }).success).toBe(false);
  });

  test("계약이 모르는 필드는 조용히 통과하지 않는다", () => {
    const withExtra = { ...경남, sortOrder: 15 };
    expect(normalizedCodeVocabularyEntryV1Schema.safeParse(withExtra).success).toBe(false);
  });

  test("봉투는 원본 행 수와 제외 행 수를 함께 싣는다", () => {
    const parsed = normalizedCodeVocabularyV1Schema.parse({
      ...vocabulary,
      sourceRowCount: 283,
      excludedRowCount: 282,
    });
    expect(parsed.sourceRowCount - parsed.excludedRowCount).toBe(parsed.entries.length);
  });

  test("음수 행 수는 봉투가 받지 않는다", () => {
    expect(normalizedCodeVocabularyV1Schema.safeParse({ ...vocabulary, excludedRowCount: -1 }).success).toBe(false);
  });
});
