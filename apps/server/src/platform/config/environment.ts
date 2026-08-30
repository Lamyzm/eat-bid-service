import { z } from "zod";

export interface Environment {
  readonly runtimeMode: "development" | "test" | "production";
  readonly port: number;
  readonly corsOrigins: readonly string[];
  readonly proxyHops: number;
  readonly payloadLimitBytes: number;
  readonly shutdownGraceMs: number;
  readonly swaggerEnabled: boolean;
  readonly buildSha: string;
  readonly databaseUrl: string;
}

type EnvironmentSource = Readonly<Record<string, string | undefined>>;

const integer = (minimum: number, maximum: number) => z.string().regex(/^[0-9]+$/)
  .transform(Number)
  .pipe(z.number().int().min(minimum).max(maximum));

const sourceSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]),
  PORT: integer(0, 65_535).optional(),
  CORS_ORIGINS: z.string().min(1).optional(),
  TRUST_PROXY_HOPS: integer(0, 16).optional(),
  HTTP_PAYLOAD_LIMIT_BYTES: integer(1_024, 10_485_760).optional(),
  SHUTDOWN_GRACE_MS: integer(1, 300_000).optional(),
  SWAGGER_ENABLED: z.enum(["true", "false"]).optional(),
  BUILD_SHA: z.string().optional(),
  DATABASE_URL: z.string().min(1),
}).passthrough();

function parseOrigins(value: string): readonly string[] {
  const rawOrigins = value.split(",").map((origin) => origin.trim());
  if (rawOrigins.some((origin) => origin.length === 0 || origin === "*")) {
    throw new Error("CORS_ORIGINS must be an exact, non-wildcard origin set");
  }
  const origins = rawOrigins.map((origin) => {
    const url = new URL(origin);
    if ((url.protocol !== "http:" && url.protocol !== "https:")
      || url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
      throw new Error(`CORS origin must contain only scheme and authority: ${origin}`);
    }
    return url.origin;
  });
  if (new Set(origins).size !== origins.length) throw new Error("CORS_ORIGINS contains duplicates");
  return Object.freeze(origins);
}

function parseDatabaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL");
  }
  if ((url.protocol !== "postgres:" && url.protocol !== "postgresql:")
    || !url.hostname || url.pathname.length <= 1) {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL");
  }
  return value;
}

export function parseEnvironment(source: EnvironmentSource): Environment {
  const parsed = sourceSchema.parse(source);
  const production = parsed.NODE_ENV === "production";
  if (production && parsed.CORS_ORIGINS === undefined) {
    throw new Error("CORS_ORIGINS is required in production");
  }
  if (production && parsed.BUILD_SHA === undefined) {
    throw new Error("BUILD_SHA is required in production");
  }
  if (production && parsed.PORT === 0) throw new Error("PORT 0 is reserved for tests");
  const swaggerEnabled = parsed.SWAGGER_ENABLED === "true";
  if (production && swaggerEnabled) throw new Error("Swagger cannot be enabled in production");
  const buildSha = parsed.BUILD_SHA ?? "unknown";
  if (production && !/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(buildSha)) {
    throw new Error("BUILD_SHA must be a lowercase 40 or 64 character hexadecimal identity");
  }
  return Object.freeze({
    runtimeMode: parsed.NODE_ENV,
    port: parsed.PORT ?? 4400,
    corsOrigins: parseOrigins(parsed.CORS_ORIGINS ?? "http://localhost:3000"),
    proxyHops: parsed.TRUST_PROXY_HOPS ?? 0,
    payloadLimitBytes: parsed.HTTP_PAYLOAD_LIMIT_BYTES ?? 1_048_576,
    shutdownGraceMs: parsed.SHUTDOWN_GRACE_MS ?? 10_000,
    swaggerEnabled,
    buildSha,
    databaseUrl: parseDatabaseUrl(parsed.DATABASE_URL),
  });
}

/**
 * 런타임 환경 변수 접근은 이 함수로만 제한한다. 앱 생성 전에 완전한 불변 설정으로
 * 바꾸면 모듈별 기본값과 운영 중 재해석 때문에 보안 정책이 갈라지는 일을 막을 수 있다.
 */
export function readEnvironment(): Environment {
  return parseEnvironment(process.env);
}
