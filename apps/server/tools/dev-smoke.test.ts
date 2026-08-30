import { expect, test } from "bun:test";
import { runDevelopmentSmoke } from "./dev-smoke";

test("CLI 없는 development 명령이 compile·기동·재compile·재시작한다", async () => {
  const result = await runDevelopmentSmoke({ timeoutMs: 30_000 });

  expect(result).toMatchObject({
    compiler: "tsc",
    nestExecutableFound: false,
    initialBootObserved: true,
    recompilationObserved: true,
    restartObserved: true,
  });
});
