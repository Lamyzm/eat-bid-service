import "reflect-metadata";
import { systemClock } from "@eatbid/domain";
import { createApp } from "./bootstrap/create-app";
import { writeSafeFailure } from "./platform/logging/logging.module";

export async function bootstrap(): Promise<void> {
  const runtime = await createApp();
  await runtime.listen();
  runtime.logger.lifecycle("application_ready");
  // 두 신호가 연달아 와도 coordinator가 같은 Promise를 돌려주므로 종료 순서를 한 번만 수행한다.
  const shutdown = (): void => {
    void runtime.shutdown().catch((error: unknown) => {
      writeSafeFailure("shutdown_failed", error, systemClock);
      process.exitCode = 1;
    });
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

if (require.main === module) {
  void bootstrap().catch((error: unknown) => {
    writeSafeFailure("bootstrap_failed", error, systemClock);
    process.exitCode = 1;
  });
}
