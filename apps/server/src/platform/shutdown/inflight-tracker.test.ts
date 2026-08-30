import { describe, expect, test } from "bun:test";

describe("in-flight tracker", () => {
  test("counts one idempotent lease and releases it once for any terminal event", async () => {
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

  test("a grace deadline bounds a lease that never completes", async () => {
    const { InflightTracker } = await import("./inflight-tracker");
    const tracker = new InflightTracker();
    tracker.acquire();
    const started = Date.now();
    await expect(tracker.waitForZero(started + 25)).resolves.toBe(false);
    expect(Date.now() - started).toBeLessThan(250);
  });
});
