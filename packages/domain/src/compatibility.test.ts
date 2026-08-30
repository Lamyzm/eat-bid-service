import { expect, test } from "bun:test";

test("Temporal facade import가 전역 객체를 변경하지 않고 UTC Instant를 만든다", async () => {
  const before = (globalThis as { Temporal?: unknown }).Temporal;
  const { Temporal } = await import("./time/temporal");

  expect(Temporal.Instant.from("2026-08-30T00:00:00Z").toString()).toBe("2026-08-30T00:00:00Z");
  expect((globalThis as { Temporal?: unknown }).Temporal).toBe(before);
});
