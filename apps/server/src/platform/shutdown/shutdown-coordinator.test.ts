import { describe, expect, test } from "bun:test";
import { fixedClock, seconds, Temporal } from "@eatbid/domain";
import { RedactingJsonLogger } from "../logging/logging.module";

describe("shutdown coordinator 시간 경계", () => {
  test("주입된 Clock과 branded grace로 drain deadline을 계산한다", async () => {
    const { ShutdownCoordinator } = await import("./shutdown-coordinator");
    const now = Temporal.Instant.from("2026-08-30T09:00:00.123456789Z");
    const deadlines: Temporal.Instant[] = [];
    let ready = true;
    let closed = false;
    const logger = new RedactingJsonLogger({
      buildSha: "a".repeat(40),
      clock: fixedClock(now),
      write: () => undefined,
    });
    const coordinator = new ShutdownCoordinator(
      { close: async () => { closed = true; } } as never,
      { markNotReady: () => { ready = false; } } as never,
      {
        count: 0,
        waitForZero: async (deadline: Temporal.Instant) => {
          deadlines.push(deadline);
          return true;
        },
      } as never,
      logger,
      fixedClock(now),
      seconds(10),
    );

    await expect(coordinator.shutdown()).resolves.toEqual({
      drained: true,
      forced: false,
      inflightAtDeadline: 0,
    });
    expect(deadlines.map((deadline) => deadline.toString()))
      .toEqual(["2026-08-30T09:00:10.123456789Z"]);
    expect(ready).toBe(false);
    expect(closed).toBe(true);
    expect(logger.records.at(-1)?.timestamp).toBe("2026-08-30T09:00:00.123456789Z");
  });
});
