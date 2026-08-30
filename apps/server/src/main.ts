import "reflect-metadata";
import { createApp } from "./bootstrap/create-app";

export async function bootstrap(): Promise<void> {
  const runtime = await createApp();
  await runtime.listen();
  runtime.logger.log("eatbid server application context ready");
  const shutdown = (): void => {
    void runtime.shutdown().catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

if (require.main === module) {
  void bootstrap().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
