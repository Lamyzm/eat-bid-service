import { describe, expect, test } from "bun:test";

import { POSTGRES_SIGNED_BIGINT_MAX, positiveBigintIdentity } from "./postgres-identity.js";

declare const sampleBrand: unique symbol;
type SampleId = bigint & { readonly [sampleBrand]: "SampleId" };

describe("PostgreSQL signed bigint 식별자 팩토리", () => {
  test("양수이고 signed bigint 상한까지의 값을 손실 없이 연다", () => {
    expect(positiveBigintIdentity<SampleId>(9_007_199_254_740_993n, "SampleId")).toBe(9_007_199_254_740_993n);
    expect(positiveBigintIdentity<SampleId>(POSTGRES_SIGNED_BIGINT_MAX, "SampleId")).toBe(POSTGRES_SIGNED_BIGINT_MAX);
  });

  test("0·음수와 signed bigint를 넘는 값은 호출한 이름을 붙여 거부한다", () => {
    expect(() => positiveBigintIdentity<SampleId>(0n, "SampleId")).toThrow("SampleId must be a positive bigint");
    expect(() => positiveBigintIdentity<SampleId>(-1n, "SampleId")).toThrow("positive");
    expect(() => positiveBigintIdentity<SampleId>(POSTGRES_SIGNED_BIGINT_MAX + 1n, "SampleId"))
      .toThrow("SampleId must fit a PostgreSQL signed bigint");
  });
});
