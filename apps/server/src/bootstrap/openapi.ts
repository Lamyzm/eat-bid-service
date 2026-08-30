import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  auctionV1Operations,
  healthOperations,
  problemDetailsSchema,
} from "@eatbid/contracts";
import { z } from "zod";
import { createDocument } from "zod-openapi";

type OperationRoute = Readonly<{
  controllerPath: string;
  handlerPath: string;
  path: string;
}>;

export function assertOperationPath(operation: OperationRoute): void {
  // 실행 route와 계약 metadata가 갈라지면 문서가 성공해도 실제 endpoint가 달라지므로 생성 단계에서 중단한다.
  const expected = `/${operation.controllerPath}/${operation.handlerPath}`;
  if (operation.path !== expected) {
    throw new Error(`Operation path drift: expected ${expected}`);
  }
}

const problemResponse = (description: string) => ({
  description,
  content: { "application/problem+json": { schema: problemDetailsSchema } },
});

export function createOpenApiDocument(): ReturnType<typeof createDocument> {
  assertOperationPath(healthOperations.live);
  assertOperationPath(healthOperations.ready);
  if (auctionV1Operations.find.path !== "/api/v1/auctions/{auctionId}") {
    throw new Error("Auction operation path drift");
  }
  return createDocument({
    openapi: "3.0.3",
    info: {
      title: "eatbid API",
      version: "1.0.0",
      description: "Bounded canonical HTTP contracts for the eatbid server.",
    },
    paths: {
      [auctionV1Operations.find.path]: {
        get: {
          operationId: auctionV1Operations.find.operationId,
          summary: auctionV1Operations.find.summary,
          tags: ["procurement"],
          requestParams: {
            path: z.object({ auctionId: auctionV1Operations.find.pathSchema }),
          },
          responses: {
            "200": {
              description: "Canonical auction",
              content: { "application/json": { schema: auctionV1Operations.find.responseSchema } },
            },
            "400": problemResponse("Invalid auction ID"),
            "404": problemResponse("Auction not found"),
            "503": problemResponse("Database unavailable"),
            "500": problemResponse("Unexpected server defect"),
          },
        },
      },
      [healthOperations.live.path]: {
        get: {
          operationId: healthOperations.live.operationId,
          summary: healthOperations.live.summary,
          tags: ["operations"],
          responses: {
            "200": {
              description: "Process is live",
              content: { "application/json": { schema: healthOperations.live.responseSchema } },
            },
            "500": problemResponse("Unexpected server defect"),
          },
        },
      },
      [healthOperations.ready.path]: {
        get: {
          operationId: healthOperations.ready.operationId,
          summary: healthOperations.ready.summary,
          tags: ["operations"],
          responses: {
            "200": {
              description: "Application is ready",
              content: { "application/json": { schema: healthOperations.ready.responseSchema } },
            },
            "503": problemResponse("Application dependency is unavailable"),
            "500": problemResponse("Unexpected server defect"),
          },
        },
      },
    },
  });
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortJson(child)]));
  }
  return value;
}

export function serializeOpenApi(document: ReturnType<typeof createDocument>): string {
  return `${JSON.stringify(sortJson(document), null, 2)}\n`;
}

async function runCli(): Promise<void> {
  const [command, path = "openapi/openapi.json"] = process.argv.slice(2);
  const target = resolve(path);
  const generated = serializeOpenApi(createOpenApiDocument());
  if (command === "--write") {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, generated, "utf8");
    return;
  }
  if (command === "--check") {
    // 같은 파일을 덮어쓴 뒤 읽는 검사는 stale artifact를 숨길 수 있어 별도 임시 파일의 바이트와 비교한다.
    const temporaryDirectory = await mkdtemp(join(tmpdir(), "eatbid-openapi-check-"));
    try {
      const generatedPath = join(temporaryDirectory, "openapi.json");
      await writeFile(generatedPath, generated, "utf8");
      const [committed, temporary] = await Promise.all([
        readFile(target, "utf8"),
        readFile(generatedPath, "utf8"),
      ]);
      if (committed !== temporary) throw new Error(`OpenAPI artifact is stale: ${target}`);
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
    return;
  }
  throw new Error("Usage: openapi.ts (--write|--check) <path>");
}

if (require.main === module) {
  void runCli().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
