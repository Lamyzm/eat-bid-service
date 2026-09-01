/** @module 책임: 공개 operation registry를 OpenAPI 문서와 검증 가능한 산출물로 변환한다. */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  publicHttpOperationRegistry,
  type PublicHttpOperation,
} from "@eatbid/contracts";
import { z } from "zod";
import {
  createDocument,
  type ZodOpenApiOperationObject,
  type ZodOpenApiPathItemObject,
  type ZodOpenApiPathsObject,
  type ZodOpenApiResponsesObject,
} from "zod-openapi";

type OpenApiStatus = `${1 | 2 | 3 | 4 | 5}${string}`;

function openApiStatus(status: number): OpenApiStatus {
  const value = String(status);
  if (!/^[1-5][0-9]{2}$/.test(value)) throw new Error(`OpenAPI status가 유효하지 않습니다: ${value}`);
  return value as OpenApiStatus;
}

function responsesFor(operation: PublicHttpOperation): ZodOpenApiResponsesObject {
  const responses: ZodOpenApiResponsesObject = {};
  for (const status of operation.successStatuses) {
    const response = operation.successResponses[status];
    if (!response) throw new Error(`${operation.operationId} success ${status} 계약이 없습니다.`);
    responses[openApiStatus(status)] = {
      description: response.description,
      content: { "application/json": { schema: response.schema } },
    };
  }
  for (const status of operation.problemStatuses) {
    const response = operation.problemResponses[status];
    if (!response) throw new Error(`${operation.operationId} problem ${status} 계약이 없습니다.`);
    responses[openApiStatus(status)] = {
      description: response.description,
      content: { "application/problem+json": { schema: response.schema } },
    };
  }
  return responses;
}

function operationDocument(operation: PublicHttpOperation): ZodOpenApiOperationObject {
  const document: ZodOpenApiOperationObject = {
    operationId: operation.operationId,
    summary: operation.summary,
    tags: [...operation.tags],
    responses: responsesFor(operation),
  };
  if (operation.route.segments.some((segment) => typeof segment !== "string")) {
    if (!(operation.pathSchema instanceof z.ZodObject)) {
      throw new Error(`${operation.operationId} path schema는 Zod object여야 합니다.`);
    }
    document.requestParams = { path: operation.pathSchema };
  }
  return document;
}

function operationPaths(): ZodOpenApiPathsObject {
  const paths: ZodOpenApiPathsObject = {};
  for (const operation of publicHttpOperationRegistry) {
    const pathItem: ZodOpenApiPathItemObject = {};
    pathItem[operation.method] = operationDocument(operation);
    paths[operation.openApiPath] = pathItem;
  }
  return paths;
}

export function createOpenApiDocument(): ReturnType<typeof createDocument> {
  return createDocument({
    openapi: "3.0.3",
    info: {
      title: "eatbid API",
      version: "1.0.0",
      description: "eatbid Server가 제공하는 경계가 명확한 공개 HTTP 계약이다.",
    },
    paths: operationPaths(),
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
