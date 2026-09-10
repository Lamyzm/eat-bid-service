/**
 * @module 책임: 런타임 환경 변수를 기동 시점에 한 번 검증해 불변 설정으로 좁히고, 잘못된 조합이 배포되지
 * 않도록 여기서 끊는다.
 */
import { z } from "zod";
import {
  milliseconds,
  payloadByteLimit,
  type ElapsedMilliseconds,
  type PayloadByteLimit,
} from "@eatbid/domain";

/** Google OAuth client 쌍이다. 둘은 항상 함께 있어야 하며 하나만 있는 배포는 기동 시점에 실패한다. */
export interface AuthGoogleCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
}

/**
 * 인증 설정은 secret·base URL과 로그인 방법 하나 이상이 있을 때만 존재한다. 일부만 있는 상태를 "일부 켜짐"으로
 * 두면 로그인 화면은 열리는데 콜백이 실패하는 배포가 되고, 그 실패는 사용자 오류처럼 보인다. 값이 아예 없는
 * 배포는 인증을 끈 배포이고 공개 read는 그대로 동작한다(ADR 0032 §1).
 */
export interface AuthEnvironment {
  readonly secret: string;
  readonly baseUrl: string;
  /** 운영의 유일한 가입 방법이다. 개발 로그인만 켠 로컬은 `null`이며 provider 조립이 Google을 등록하지 않는다. */
  readonly google: AuthGoogleCredentials | null;
  /**
   * 이메일·비밀번호 provider를 켜는 개발 전용 opt-in이다. 이 값은 게이트·guard가 아니라 provider 조립만 바꾸므로
   * 로컬 세션도 운영과 같은 판정 경로를 지난다. production은 이 값을 기동 시점에 거부한다(ADR 0032 §13).
   */
  readonly devLoginEnabled: boolean;
  /**
   * `Secure` 쿠키는 https에서만 브라우저에 저장된다. loopback HTTP dev에서 이 값을 강제로 켜면 로그인이
   * 성공해도 세션 쿠키가 버려져 매 요청이 미로그인이 된다. 그래서 base URL의 scheme이 이 값을 정하며,
   * 이 값이 거짓일 수 있는 경우는 startup이 이미 loopback 개발 host로 좁혀 놓았다.
   */
  readonly useSecureCookies: boolean;
}

export interface Environment {
  readonly runtimeMode: "development" | "test" | "production";
  readonly port: number;
  readonly corsOrigins: readonly string[];
  readonly proxyHops: number;
  readonly payloadLimit: PayloadByteLimit;
  readonly shutdownGrace: ElapsedMilliseconds;
  readonly swaggerEnabled: boolean;
  readonly buildSha: string;
  readonly databaseUrl: string;
  readonly auth: AuthEnvironment | null;
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
  BETTER_AUTH_SECRET: z.string().min(32).optional(),
  BETTER_AUTH_URL: z.string().min(1).optional(),
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  EATBID_DEV_LOGIN: z.enum(["true", "false"]).optional(),
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

// http는 브라우저가 `Secure` 쿠키를 저장하지 않는 경우에만 쓸 수 있다. 그 경우는 개발자 자기 기기의
// loopback 하나뿐이며, 다른 host의 http는 세션 쿠키를 평문으로 실어 보내는 배포다.
const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function parseGoogle(parsed: z.infer<typeof sourceSchema>): AuthGoogleCredentials | null {
  const entries = {
    GOOGLE_CLIENT_ID: parsed.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: parsed.GOOGLE_CLIENT_SECRET,
  };
  const missing = Object.entries(entries).filter(([, value]) => value === undefined).map(([key]) => key);
  if (missing.length === Object.keys(entries).length) return null;
  if (missing.length > 0) {
    throw new Error(`Authentication configuration is incomplete; missing ${missing.join(", ")}`);
  }
  return Object.freeze({ clientId: entries.GOOGLE_CLIENT_ID!, clientSecret: entries.GOOGLE_CLIENT_SECRET! });
}

function parseAuth(
  parsed: z.infer<typeof sourceSchema>,
  runtimeMode: Environment["runtimeMode"],
  devLoginEnabled: boolean,
): AuthEnvironment | null {
  const google = parseGoogle(parsed);
  const entries = {
    BETTER_AUTH_SECRET: parsed.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: parsed.BETTER_AUTH_URL,
  };
  const missing = Object.entries(entries).filter(([, value]) => value === undefined).map(([key]) => key);
  if (google === null && !devLoginEnabled && missing.length === Object.keys(entries).length) return null;
  /**
   * 개발 로그인 모드에서도 secret과 base URL은 고정 개발값으로 대신하지 않는다. secret은 세션 쿠키와 서명된
   * 세션 사본의 서명 열쇠라 코드에 적힌 공개값이 되면 `NODE_ENV=development`로 띄운 어떤 배포에서든 세션을
   * 위조할 수 있고, base URL은 쿠키 `Secure` 판정과 콜백 origin의 근거라 기기마다 다르다. 둘을 빠뜨린 실수는
   * 여기서 한 줄로 드러나는 편이 낫다.
   */
  if (missing.length > 0) {
    throw new Error(`Authentication configuration is incomplete; missing ${missing.join(", ")}`);
  }
  // secret과 URL만 있고 로그인 방법이 없는 배포는 로그인 화면은 열리는데 어떤 버튼도 성공할 수 없는 배포다.
  if (google === null && !devLoginEnabled) {
    throw new Error(
      "Authentication configuration has no sign-in method; set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET,"
      + " or EATBID_DEV_LOGIN=true outside production",
    );
  }
  let url: URL;
  try {
    url = new URL(entries.BETTER_AUTH_URL!);
  } catch {
    throw new Error("BETTER_AUTH_URL must be an absolute http or https URL");
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.search || url.hash
    || url.username || url.password) {
    throw new Error("BETTER_AUTH_URL must contain only scheme, authority and path");
  }
  // https가 아니면 세션 쿠키에 `Secure`를 붙일 수 없다. 그 상태를 배포가 조용히 고르지 못하게 시작 시점에
  // 막는다. 검사를 뒤로 미루면 로그인은 되는데 쿠키가 평문으로 오가는 배포가 정상처럼 동작한다.
  if (url.protocol === "http:") {
    if (runtimeMode === "production") {
      throw new Error("BETTER_AUTH_URL must use https in production");
    }
    if (!loopbackHosts.has(url.hostname)) {
      throw new Error("BETTER_AUTH_URL may only use http on a loopback host outside production");
    }
  }
  return Object.freeze({
    secret: entries.BETTER_AUTH_SECRET!,
    baseUrl: url.origin + (url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "")),
    google,
    devLoginEnabled,
    useSecureCookies: url.protocol === "https:",
  });
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
  // 이메일·비밀번호 provider는 메일 발송·재설정·비밀번호 저장이 전부 보안 표면이라 운영 가입 방법이 아니다.
  // 운영 배포에 이 플래그가 섞여 들어오면 다른 값이 모두 정상이어도 여기서 기동을 끊는다(ADR 0032 §13).
  const devLoginEnabled = parsed.EATBID_DEV_LOGIN === "true";
  if (production && devLoginEnabled) throw new Error("Dev login cannot be enabled in production");
  const buildSha = parsed.BUILD_SHA ?? "unknown";
  if (production && !/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(buildSha)) {
    throw new Error("BUILD_SHA must be a lowercase 40 or 64 character hexadecimal identity");
  }
  return Object.freeze({
    runtimeMode: parsed.NODE_ENV,
    port: parsed.PORT ?? 4400,
    corsOrigins: parseOrigins(parsed.CORS_ORIGINS ?? "http://localhost:3000"),
    proxyHops: parsed.TRUST_PROXY_HOPS ?? 0,
    payloadLimit: payloadByteLimit(parsed.HTTP_PAYLOAD_LIMIT_BYTES ?? 1_048_576),
    shutdownGrace: milliseconds(parsed.SHUTDOWN_GRACE_MS ?? 10_000),
    swaggerEnabled,
    buildSha,
    databaseUrl: parseDatabaseUrl(parsed.DATABASE_URL),
    auth: parseAuth(parsed, parsed.NODE_ENV, devLoginEnabled),
  });
}

/**
 * 런타임 환경 변수 접근은 이 함수로만 제한한다. 앱 생성 전에 완전한 불변 설정으로
 * 바꾸면 모듈별 기본값과 운영 중 재해석 때문에 보안 정책이 갈라지는 일을 막을 수 있다.
 */
export function readEnvironment(): Environment {
  return parseEnvironment(process.env);
}
