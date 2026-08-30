import { describe, expect, test } from "bun:test";

describe("검증 범위를 정의한다 — in-flight tracker", () => {
  test("계수 결과를 검증한다 — counts one idempotent lease and releases it once for any terminal event", async () => {
    const module = await import("./inflight-tracker").catch(() => undefined);
    expect(module, "in-flight tracker must exist").toBeDefined();
    const tracker = new module!.InflightTracker();
    const release = tracker.acquire();
    expect(tracker.count).toBe(1);
    release();
    release();
    expect(tracker.count).toBe(0);
    await expect(tracker.waitForZero(Date.now() + 10)).resolves.toBe(true);
  });

  test("동작을 검증한다 — a grace deadline bounds a lease that never completes", async () => {
    const { InflightTracker } = await import("./inflight-tracker");
    const tracker = new InflightTracker();
    tracker.acquire();
    const started = Date.now();
    await expect(tracker.waitForZero(started + 25)).resolves.toBe(false);
    expect(Date.now() - started).toBeLessThan(250);
  });
});
