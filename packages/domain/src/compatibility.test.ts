import { expect, test } from "bun:test";
import { Temporal } from "./time/temporal";

test("Temporal facade가 전역 객체를 변경하지 않고 UTC Instant를 만든다", () => {
  const before = (globalThis as { Temporal?: unknown }).Temporal;
  expect(Temporal.Instant.from("2026-08-30T00:00:00Z").toString()).toBe("2026-08-30T00:00:00Z");
  expect((globalThis as { Temporal?: unknown }).Temporal).toBe(before);
});
