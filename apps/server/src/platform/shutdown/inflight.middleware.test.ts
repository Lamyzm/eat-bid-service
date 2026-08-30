import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { createInflightMiddleware } from "./inflight.middleware";
import { InflightTracker } from "./inflight-tracker";

describe("in-flight middleware terminal events", () => {
  for (const event of ["finish", "close", "aborted"] as const) {
    test(`releases exactly once when ${event} terminates the request`, () => {
      const tracker = new InflightTracker();
      const incoming = new EventEmitter();
      const response = new EventEmitter();
      let nextCalls = 0;
      createInflightMiddleware(tracker)(incoming as never, response as never, () => { nextCalls += 1; });
      expect(tracker.count).toBe(1);
      (event === "aborted" ? incoming : response).emit(event);
      response.emit("finish");
      response.emit("close");
      incoming.emit("aborted");
      expect(tracker.count).toBe(0);
      expect(nextCalls).toBe(1);
    });
  }
});
