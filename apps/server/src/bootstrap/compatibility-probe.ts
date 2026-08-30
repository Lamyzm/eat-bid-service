import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { AppModule } from "../app.module";

export const expectedNodeVersion = "v24.20.0";

// compatibility probe로 검증한 framework/runtime 조합만 허용해 지원되지 않은 조합의 암묵적 승격을 막는다.
export function assertExactNodeVersion(actualVersion: string): string {
  if (actualVersion !== expectedNodeVersion) {
    throw new Error(`Expected Node ${expectedNodeVersion}, received ${actualVersion}`);
  }
  return actualVersion;
}

export async function createAndCloseApplicationContext(): Promise<{ readonly closed: true }> {
  const application = await NestFactory.createApplicationContext(AppModule, { logger: false });
  await application.close();
  return { closed: true };
}

export function installedPackageVersions(): {
  readonly nestVersion: string;
  readonly effectVersion: string;
} {
  const nestPackagePath = join(dirname(require.resolve("@nestjs/core")), "package.json");
  const nestPackage = JSON.parse(readFileSync(nestPackagePath, "utf8")) as { version: string };
  const effectPackage = JSON.parse(
    readFileSync(require.resolve("effect/package.json"), "utf8"),
  ) as { version: string };
  return { nestVersion: nestPackage.version, effectVersion: effectPackage.version };
}

export async function runCompatibilityProbe(): Promise<void> {
  const nodeVersion = assertExactNodeVersion(process.version);
  await createAndCloseApplicationContext();
  const { nestVersion, effectVersion } = installedPackageVersions();
  if (nestVersion !== "12.0.1") throw new Error(`Expected Nest core 12.0.1, received ${nestVersion}`);
  if (effectVersion !== "4.0.0-rc.112") {
    throw new Error(`Expected Effect 4.0.0-rc.112, received ${effectVersion}`);
  }
  console.log(JSON.stringify({ nodeVersion, nestVersion, effectVersion, applicationContextClosed: true }));
}

if (require.main === module) {
  void runCompatibilityProbe().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
