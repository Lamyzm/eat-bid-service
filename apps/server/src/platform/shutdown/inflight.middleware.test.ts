import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { createInflightMiddleware } from "./inflight.middleware";
import { InflightTracker } from "./inflight-tracker";

describe("inflight middleware 종료 event", () => {
  test.each(["finish", "close", "aborted"] as const)(
    "%s event가 요청을 종료해도 lease를 정확히 한 번 해제한다",
    (event) => {
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
    },
  );
});
