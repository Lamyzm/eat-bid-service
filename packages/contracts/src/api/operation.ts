import { z } from "zod";

export type HttpMethod = "delete" | "get" | "patch" | "post" | "put";

export type OperationVersioning = Readonly<
  | { kind: "neutral" }
  | { kind: "uri"; prefix: string; version: string }
>;

export type PathParameter<Name extends string = string> = Readonly<{
  kind: "parameter";
  name: Name;
}>;

export type SemanticPathSegment = string | PathParameter;

export interface SemanticRoute {
  readonly resource: string;
  readonly segments: readonly SemanticPathSegment[];
}

type Schema = z.ZodType;

export interface OperationResponse<SchemaType extends Schema = Schema> {
  readonly description: string;
  readonly schema: SchemaType;
}

export type OperationResponseMap = Readonly<Record<number, OperationResponse>>;

export interface PublicHttpOperation<
  PathSchema extends Schema = Schema,
  QuerySchema extends Schema = Schema,
  BodySchema extends Schema = Schema,
  SuccessResponses extends OperationResponseMap = OperationResponseMap,
  ProblemResponses extends OperationResponseMap = OperationResponseMap,
> {
  readonly method: HttpMethod;
  readonly versioning: OperationVersioning;
  readonly route: SemanticRoute;
  readonly controllerPath: string;
  readonly handlerPath: string;
  readonly version: string | null;
  readonly openApiPath: string;
  readonly path: string;
  readonly operationId: string;
  readonly implementationOwner: "server" | "web";
  readonly summary: string;
  readonly tags: readonly string[];
  readonly pathSchema: PathSchema;
  readonly querySchema: QuerySchema;
  readonly bodySchema: BodySchema;
  readonly successResponses: SuccessResponses;
  readonly problemResponses: ProblemResponses;
  readonly successStatuses: readonly number[];
  readonly problemStatuses: readonly number[];
  readonly errorStatuses: readonly number[];
  buildPath(input: {
    readonly path: z.input<PathSchema>;
    readonly query?: z.input<QuerySchema>;
  }): string;
}

export type OperationPathInput<Operation extends PublicHttpOperation> =
  Operation extends PublicHttpOperation<infer PathSchema> ? z.input<PathSchema> : never;

export type OperationQueryInput<Operation extends PublicHttpOperation> =
  Operation extends PublicHttpOperation<Schema, infer QuerySchema> ? z.input<QuerySchema> : never;

export type OperationBodyInput<Operation extends PublicHttpOperation> =
  Operation extends PublicHttpOperation<Schema, Schema, infer BodySchema> ? z.input<BodySchema> : never;

type ResponseSchema<Response> = Response extends OperationResponse<infer SchemaType>
  ? SchemaType
  : never;

export type OperationSuccess<Operation extends PublicHttpOperation> =
  Operation extends PublicHttpOperation<Schema, Schema, Schema, infer Responses>
    ? z.output<ResponseSchema<Responses[keyof Responses]>>
    : never;

export function pathParameter<const Name extends string>(name: Name): PathParameter<Name> {
  assertSegment(name, "path parameter");
  return Object.freeze({ kind: "parameter", name });
}

function assertSegment(value: string, label: string): void {
  if (!value || value.includes("/") || value === "." || value === "..") {
    throw new Error(`${label}는 비어 있지 않은 단일 path segment여야 합니다.`);
  }
}

function statusKeys(responses: OperationResponseMap, range: readonly [number, number], label: string): number[] {
  const statuses = Object.keys(responses).map(Number).toSorted((left, right) => left - right);
  for (const status of statuses) {
    if (!Number.isInteger(status) || status < range[0] || status > range[1]) {
      throw new Error(`${label} status ${status}가 허용 범위를 벗어났습니다.`);
    }
  }
  return statuses;
}

function freezeResponses<const Responses extends OperationResponseMap>(responses: Responses): Responses {
  return Object.freeze(Object.fromEntries(Object.entries(responses).map(([status, response]) => [
    status,
    Object.freeze({ ...response }),
  ]))) as Responses;
}

function queryString(value: unknown): string {
  if (value === undefined) return "";
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("query schema는 object 또는 undefined를 반환해야 합니다.");
  }
  const search = new URLSearchParams();
  for (const key of Object.keys(value).toSorted()) {
    const item = (value as Record<string, unknown>)[key];
    const values = Array.isArray(item) ? item : [item];
    for (const entry of values) {
      if (entry === undefined) continue;
      if (entry === null || !["bigint", "boolean", "number", "string"].includes(typeof entry)) {
        throw new Error(`query ${key}는 wire primitive 또는 배열이어야 합니다.`);
      }
      search.append(key, String(entry));
    }
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : "";
}

function parsedPathRecord(value: unknown, parameters: readonly PathParameter[]): Record<string, unknown> {
  if (parameters.length === 0) return {};
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("path schema는 parameter 이름을 가진 object를 반환해야 합니다.");
  }
  return value as Record<string, unknown>;
}

function renderRoute(
  versioning: OperationVersioning,
  route: SemanticRoute,
  parameterStyle: "nest" | "openapi",
): string {
  const versionSegments = versioning.kind === "uri"
    ? [versioning.prefix, `v${versioning.version}`]
    : [];
  const operationSegments = route.segments.map((segment) => typeof segment === "string"
    ? segment
    : parameterStyle === "nest" ? `:${segment.name}` : `{${segment.name}}`);
  return [...versionSegments, route.resource, ...operationSegments].join("/");
}

export function defineOperation<
  const Method extends HttpMethod,
  const Versioning extends OperationVersioning,
  const Route extends SemanticRoute,
  const PathSchema extends Schema,
  const QuerySchema extends Schema,
  const BodySchema extends Schema,
  const SuccessResponses extends OperationResponseMap,
  const ProblemResponses extends OperationResponseMap,
>(definition: {
  readonly method: Method;
  readonly versioning: Versioning;
  readonly route: Route;
  readonly operationId: string;
  readonly implementationOwner: "server" | "web";
  readonly summary: string;
  readonly tags: readonly string[];
  readonly pathSchema: PathSchema;
  readonly querySchema: QuerySchema;
  readonly bodySchema: BodySchema;
  readonly successResponses: SuccessResponses;
  readonly problemResponses: ProblemResponses;
}): PublicHttpOperation<PathSchema, QuerySchema, BodySchema, SuccessResponses, ProblemResponses>
  & Readonly<{ method: Method; versioning: Versioning; route: Route }> {
  assertSegment(definition.route.resource, "resource");
  if (definition.versioning.kind === "uri") {
    assertSegment(definition.versioning.prefix, "URI prefix");
    if (!/^[1-9][0-9]*$/.test(definition.versioning.version)) {
      throw new Error("URI version은 1 이상의 canonical decimal text여야 합니다.");
    }
    if (definition.versioning.prefix === "api" && definition.implementationOwner !== "server") {
      throw new Error("/api ingress의 implementationOwner는 server여야 합니다.");
    }
  }
  const parameters = definition.route.segments.filter((segment): segment is PathParameter => typeof segment !== "string");
  const parameterNames = new Set<string>();
  for (const segment of definition.route.segments) {
    if (typeof segment === "string") assertSegment(segment, "static path");
    else if (parameterNames.has(segment.name)) throw new Error(`중복 path parameter: ${segment.name}`);
    else parameterNames.add(segment.name);
  }
  const successStatuses = statusKeys(definition.successResponses, [200, 299], "success");
  const problemStatuses = statusKeys(definition.problemResponses, [400, 599], "problem");
  if (successStatuses.length === 0) throw new Error("하나 이상의 success response가 필요합니다.");
  const versioning = Object.freeze({ ...definition.versioning }) as Versioning;
  const route = Object.freeze({
    ...definition.route,
    segments: Object.freeze([...definition.route.segments]),
  }) as Route;
  const successResponses = freezeResponses(definition.successResponses);
  const problemResponses = freezeResponses(definition.problemResponses);
  const controllerPath = route.resource;
  const handlerPath = route.segments.map((segment) => typeof segment === "string" ? segment : `:${segment.name}`).join("/");
  const openApiPath = `/${renderRoute(versioning, route, "openapi")}`;
  const descriptor = {
    ...definition,
    versioning,
    route,
    tags: Object.freeze([...definition.tags]),
    successResponses,
    problemResponses,
    controllerPath,
    handlerPath,
    version: definition.versioning.kind === "uri" ? definition.versioning.version : null,
    openApiPath,
    path: openApiPath,
    successStatuses: Object.freeze(successStatuses),
    problemStatuses: Object.freeze(problemStatuses),
    errorStatuses: Object.freeze(problemStatuses),
    buildPath(input: { readonly path: z.input<PathSchema>; readonly query?: z.input<QuerySchema> }): string {
      if (input === null || typeof input !== "object") throw new Error("buildPath input은 object여야 합니다.");
      const extraKeys = Object.keys(input).filter((key) => key !== "path" && key !== "query");
      if (extraKeys.length) throw new Error(`buildPath는 ${extraKeys.join(", ")} 값을 받지 않습니다.`);
      // 두 schema를 모두 검증한 뒤에만 encoding을 시작해 부분적으로 조립된 경로가 외부로 새지 않게 한다.
      const parsedPath = definition.pathSchema.parse(input.path);
      const parsedQuery = definition.querySchema.parse(input.query);
      const values = parsedPathRecord(parsedPath, parameters);
      const segments = route.segments.map((segment) => {
        if (typeof segment === "string") return segment;
        const value = values[segment.name];
        if (!["bigint", "number", "string"].includes(typeof value)) {
          throw new Error(`path parameter ${segment.name}는 wire primitive여야 합니다.`);
        }
        return encodeURIComponent(String(value));
      });
      const versionSegments = versioning.kind === "uri"
        ? [versioning.prefix, `v${versioning.version}`]
        : [];
      return `/${[...versionSegments, route.resource, ...segments].join("/")}${queryString(parsedQuery)}`;
    },
  };
  return Object.freeze(descriptor);
}

export function createOperationRegistry<const Operations extends readonly PublicHttpOperation[]>(
  operations: Operations,
): Operations {
  const operationIds = new Set<string>();
  const routes = new Set<string>();
  for (const operation of operations) {
    if (operationIds.has(operation.operationId)) throw new Error(`중복 operationId: ${operation.operationId}`);
    operationIds.add(operation.operationId);
    const routeKey = `${operation.method} ${operation.openApiPath}`;
    if (routes.has(routeKey)) throw new Error(`중복 method+path: ${routeKey}`);
    routes.add(routeKey);
  }
  return Object.freeze([...operations]) as unknown as Operations;
}
