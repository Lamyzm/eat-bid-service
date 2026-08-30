import { describe, expect, test } from "bun:test";

import { fixedClock, systemClock } from "./clock.js";
import { Temporal } from "./temporal.js";

describe("주입 가능한 시계", () => {
  test("고정 시계가 주입한 Instant를 반복해서 반환한다", () => {
    const instant = Temporal.Instant.from("2026-08-30T12:34:56Z");
    const clock = fixedClock(instant);

    expect(clock.now()).toBe(instant);
    expect(clock.now()).toBe(instant);
  });

  test("시스템 시계가 Temporal Instant를 반환한다", () => {
    expect(systemClock.now()).toBeInstanceOf(Temporal.Instant);
  });
});
