import { describe, expect, test } from "bun:test";
import { isUniqueViolation } from "./drizzle-account-repository";

describe("unique 위반 판별", () => {
  test("driver 오류가 감싸여 있어도 23505를 찾아낸다", () => {
    // Drizzle은 driver 오류를 DrizzleQueryError로 감싼다. 최상위 code만 보면 동시 초기화에서 진 트랜잭션이
    // 재시도 대신 의존성 장애로 처리된다.
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
    expect(isUniqueViolation(Object.assign(new Error("query failed"), {
      cause: Object.assign(new Error("duplicate key"), { code: "23505" }),
    }))).toBe(true);
    expect(isUniqueViolation({ cause: { cause: { code: "23505" } } })).toBe(true);
  });

  test("다른 실패를 unique 위반으로 오인하지 않는다", () => {
    expect(isUniqueViolation({ code: "23503" })).toBe(false);
    expect(isUniqueViolation(new Error("boom"))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation("23505")).toBe(false);
  });

  test("깊은 사슬과 순환 사슬에서 멈춘다", () => {
    // 상한이 없으면 재시도 판정이 원인 사슬을 따라가다 멈추지 못한다.
    const deep = { cause: { cause: { cause: { cause: { cause: { code: "23505" } } } } } };
    expect(isUniqueViolation(deep)).toBe(false);

    const cyclic: { cause?: unknown } = {};
    cyclic.cause = cyclic;
    expect(isUniqueViolation(cyclic)).toBe(false);
  });
});
