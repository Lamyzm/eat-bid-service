import { describe, expect, test } from "bun:test";
import {
  fixedClock,
  seconds,
  Temporal,
  toMilliseconds,
  type Clock,
  type ElapsedMilliseconds,
} from "@eatbid/domain";
// records는 RedactingJsonLogger에 없다. 첫 테스트가 logger.records를 읽으므로 관측 전용
// RecordingJsonLogger로 만든다(EAT-157).
import { RecordingJsonLogger } from "../logging/logging.module";

describe("shutdown coordinator 시간 경계", () => {
  test("wall clock deadline을 만들지 않고 branded 상대 grace를 tracker에 전달한다", async () => {
    const { ShutdownCoordinator } = await import("./shutdown-coordinator");
    const now = Temporal.Instant.from("2026-08-30T09:00:00.123456789Z");
    const graceValues: ElapsedMilliseconds[] = [];
    let clockReads = 0;
    const sequenceClock: Clock = {
      now: () => {
        clockReads += 1;
        return clockReads === 1 ? now : now.add({ hours: 24 });
      },
    };
    let ready = true;
    let closed = false;
    const logger = new RecordingJsonLogger({
      buildSha: "a".repeat(40),
      clock: sequenceClock,
      write: () => undefined,
    });
    const coordinator = new ShutdownCoordinator(
      { close: async () => { closed = true; } } as never,
      { markNotReady: () => { ready = false; } } as never,
      {
        count: 0,
        waitForZero: async (grace: ElapsedMilliseconds) => {
          graceValues.push(grace);
          return true;
        },
      } as never,
      logger,
      seconds(10),
    );

    await expect(coordinator.shutdown()).resolves.toEqual({
      drained: true,
      forced: false,
      inflightAtDeadline: 0,
    });
    expect(graceValues.map(toMilliseconds)).toEqual([10_000]);
    expect(ready).toBe(false);
    expect(closed).toBe(true);
    expect(clockReads, "logger timestamp 외 wall clock을 grace 계산에 읽지 않아야 한다").toBe(1);
    expect(logger.records.at(-1)?.timestamp).toBe("2026-08-30T09:00:00.123456789Z");
  });

  test("여러 shutdown 호출이 같은 상대 grace 작업을 공유한다", async () => {
    const { ShutdownCoordinator } = await import("./shutdown-coordinator");
    let waitCalls = 0;
    let closeCalls = 0;
    const logger = new RecordingJsonLogger({
      buildSha: "a".repeat(40),
      clock: fixedClock(Temporal.Instant.from("2026-08-30T09:00:00Z")),
      write: () => undefined,
    });
    const coordinator = new ShutdownCoordinator(
      { close: async () => { closeCalls += 1; } } as never,
      { markNotReady: () => undefined } as never,
      {
        count: 0,
        waitForZero: async () => {
          waitCalls += 1;
          return true;
        },
      } as never,
      logger,
      seconds(10),
    );

    const first = coordinator.shutdown();
    const second = coordinator.shutdown();
    expect(first).toBe(second);
    await expect(first).resolves.toMatchObject({ drained: true, forced: false });
    expect(waitCalls).toBe(1);
    expect(closeCalls).toBe(1);
  });
});
