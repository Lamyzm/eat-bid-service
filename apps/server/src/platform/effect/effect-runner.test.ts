import { describe, expect, test } from "bun:test";
import * as Effect from "effect/Effect";
import { EffectRunner } from "./effect-runner";

class ExpectedFailure extends Error {
  readonly _tag = "ExpectedFailure";
}

describe("EffectRunner 실행 경계", () => {
  const runner = new EffectRunner();

  test("성공한 Effect 값을 반환한다", async () => {
    await expect(runner.run(Effect.succeed({ id: 42n }))).resolves.toEqual({ id: 42n });
  });

  test("원래 typed expected failure로 reject한다", async () => {
    const failure = new ExpectedFailure("not found");

    await expect(runner.run(Effect.fail(failure))).rejects.toBe(failure);
  });

  test("원래 unexpected defect로 reject한다", async () => {
    const defect = new Error("unexpected defect");

    await expect(runner.run(Effect.die(defect))).rejects.toBe(defect);
  });

  test("AbortSignal로 실행을 취소한다", async () => {
    const controller = new AbortController();
    const running = runner.run(Effect.never, { signal: controller.signal });

    controller.abort(new Error("request cancelled"));

    await expect(running).rejects.toMatchObject({ name: "AbortError" });
  });
});
