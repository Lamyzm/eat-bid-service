import { describe, expect, test } from "bun:test";
import * as Effect from "effect/Effect";
import { EffectRunner } from "./effect-runner";

class ExpectedFailure extends Error {
  readonly _tag = "ExpectedFailure";
}

describe("검증 범위를 정의한다 — EffectRunner", () => {
  const runner = new EffectRunner();

  test("반환 결과를 검증한다 — returns a successful Effect value", async () => {
    await expect(runner.run(Effect.succeed({ id: 42n }))).resolves.toEqual({ id: 42n });
  });

  test("거부 조건을 검증한다 — rejects with the original typed expected failure", async () => {
    const failure = new ExpectedFailure("not found");

    await expect(runner.run(Effect.fail(failure))).rejects.toBe(failure);
  });

  test("거부 조건을 검증한다 — rejects with the original unexpected defect", async () => {
    const defect = new Error("unexpected defect");

    await expect(runner.run(Effect.die(defect))).rejects.toBe(defect);
  });

  test("취소 동작을 검증한다 — cancels execution through AbortSignal", async () => {
    const controller = new AbortController();
    const running = runner.run(Effect.never, { signal: controller.signal });

    controller.abort(new Error("request cancelled"));

    await expect(running).rejects.toMatchObject({ name: "AbortError" });
  });
});
