import { expect, test } from "bun:test";
import { developmentSmokeBudgetMs, runDevelopmentSmoke } from "./dev-smoke";

// 러너 타임아웃은 단계 상한 합계보다 크게 잡는다. 러너가 먼저 끊으면 자식 종료와 임시 디렉터리 정리가
// 다음 테스트 파일이 도는 동안 이어지고, 그 실패가 엉뚱한 테스트에 붙어 원인을 감춘다.
const runnerTimeoutMs = developmentSmokeBudgetMs + 60_000;

test("CLI 없는 development 명령이 compile·기동·재compile·재시작한다", async () => {
  const result = await runDevelopmentSmoke();

  expect(result).toMatchObject({
    compiler: "tsc",
    nestExecutableFound: false,
    initialBootObserved: true,
    recompilationObserved: true,
    restartObserved: true,
  });
  expect(result.stages.map((stage) => stage.name)).toEqual([
    "초기 compile",
    "초기 기동",
    "재compile",
    "재시작",
  ]);
}, runnerTimeoutMs);
