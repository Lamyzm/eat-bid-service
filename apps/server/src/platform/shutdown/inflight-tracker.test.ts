import { describe, expect, test } from "bun:test";
import { milliseconds } from "@eatbid/domain";

describe("inflight tracker 수명주기", () => {
  test("idempotent lease 하나를 세고 어떤 종료 event에서도 한 번만 해제한다", async () => {
    const module = await import("./inflight-tracker").catch(() => undefined);
    expect(module, "in-flight tracker must exist").toBeDefined();
    const tracker = new module!.InflightTracker();
    const release = tracker.acquire();
    expect(tracker.count).toBe(1);
    release();
    release();
    expect(tracker.count).toBe(0);
    await expect(tracker.waitForZero(milliseconds(10))).resolves.toBe(true);
  });

  test("완료되지 않는 lease도 상대 grace 안에서 종료한다", async () => {
    const { InflightTracker } = await import("./inflight-tracker");
    const tracker = new InflightTracker();
    tracker.acquire();
    await expect(tracker.waitForZero(milliseconds(25))).resolves.toBe(false);
  });

  test("active lease와 0 grace는 wall clock 없이 즉시 실패한다", async () => {
    const { InflightTracker } = await import("./inflight-tracker");
    const tracker = new InflightTracker();
    tracker.acquire();
    await expect(tracker.waitForZero(milliseconds(0))).resolves.toBe(false);
  });
});
