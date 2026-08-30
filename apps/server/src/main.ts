import "reflect-metadata";
import { createApp } from "./bootstrap/create-app";
import { writeSafeFailure } from "./platform/logging/logging.module";

export async function bootstrap(): Promise<void> {
  const runtime = await createApp();
  await runtime.listen();
  runtime.logger.lifecycle("application_ready");
  const shutdown = (): void => {
    void runtime.shutdown().catch((error: unknown) => {
      writeSafeFailure("shutdown_failed", error);
      process.exitCode = 1;
    });
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

if (require.main === module) {
  void bootstrap().catch((error: unknown) => {
    writeSafeFailure("bootstrap_failed", error);
    process.exitCode = 1;
  });
}
