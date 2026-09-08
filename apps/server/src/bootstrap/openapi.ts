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

/** query 계약은 `.default()`로 감싸도 같은 parameter 집합이므로 wrapper를 벗겨 원래 object를 찾는다. */
function queryObject(schema: z.ZodType): z.ZodObject | undefined {
  let current: z.ZodType = schema;
  while (current instanceof z.ZodDefault || current instanceof z.ZodOptional) {
    current = current.unwrap() as z.ZodType;
  }
  return current instanceof z.ZodObject ? current : undefined;
}

function operationDocument(operation: PublicHttpOperation): ZodOpenApiOperationObject {
  const document: ZodOpenApiOperationObject = {
    operationId: operation.operationId,
    summary: operation.summary,
    tags: [...operation.tags],
    responses: responsesFor(operation),
  };
  const requestParams: NonNullable<ZodOpenApiOperationObject["requestParams"]> = {};
  if (operation.route.segments.some((segment) => typeof segment !== "string")) {
    if (!(operation.pathSchema instanceof z.ZodObject)) {
      throw new Error(`${operation.operationId} path schema는 Zod object여야 합니다.`);
    }
    requestParams.path = operation.pathSchema;
  }
  const query = queryObject(operation.querySchema);
  if (query) requestParams.query = query;
  if (Object.keys(requestParams).length > 0) document.requestParams = requestParams;
  return document;
}

function operationPaths(): ZodOpenApiPathsObject {
  const paths: ZodOpenApiPathsObject = {};
  for (const operation of publicHttpOperationRegistry) {
    // 같은 semantic path에 method가 둘 이상 있을 수 있다(`GET`·`POST /api/v1/me/businesses`).
    // path item을 새로 만들어 대입하면 먼저 등록한 method가 조용히 사라져 문서에서만 endpoint가 없어진다.
    const pathItem: ZodOpenApiPathItemObject = paths[operation.openApiPath] ?? {};
    if (pathItem[operation.method]) {
      throw new Error(`중복 method+path: ${operation.method} ${operation.openApiPath}`);
    }
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
