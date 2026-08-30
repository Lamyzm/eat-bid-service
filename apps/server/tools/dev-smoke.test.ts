import { expect, test } from "bun:test";
import { runDevelopmentSmoke } from "./dev-smoke";

test("동작을 검증한다 — CLI-free development command compiles, boots, recompiles, and restarts", async () => {
  const result = await runDevelopmentSmoke({ timeoutMs: 30_000 });

  expect(result).toMatchObject({
    compiler: "tsc",
    nestExecutableFound: false,
    initialBootObserved: true,
    recompilationObserved: true,
    restartObserved: true,
  });
});
