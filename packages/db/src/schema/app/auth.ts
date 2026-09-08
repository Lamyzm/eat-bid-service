/**
 * @module 책임: Better Auth가 소유하는 provider table을 Drizzle DDL로 선언해 migration 저작권을 유지한다.
 *
 * 열 이름은 라이브러리 계약이라 저장소의 snake_case 관례를 따르지 않고 provider field 이름을 그대로 쓴다.
 * adapter가 `schema[modelName][fieldName]`으로 열을 찾기 때문에 이름을 우리 취향대로 바꾸면 검사만
 * 통과하고 런타임 질의가 깨진다. 이 표들의 정합성은 `tools/check-auth-schema.ts`가 pinned provider의
 * 기대 schema와 대조한다.
 */
import { bigint, boolean, index, integer, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { appSchema } from "../namespaces.js";
import { authTableNames } from "./auth-schema-options.js";

// provider가 문자열 ID를 만들고 그 값은 인증 transport 내부 식별자다. application 관계는 이 문자열을
// FK로 쓰지 않고 `identity_subject`를 거쳐 bigint principal로만 연결한다(ADR 0018).
const providerId = text("id").primaryKey();

// 시각 열은 `timestamptz`다. provider는 `Date`를 넣고 읽는데 `timestamp without time zone`으로 두면
// 세션 만료 판정이 서버 지역시간에 따라 흔들린다. 논리 타입은 그대로 date이므로 conformance 대조도 통과한다.
const providerTimestamp = (name: string) => timestamp(name, { withTimezone: true });

export const authUser = appSchema.table(
  authTableNames.user,
  {
    id: providerId,
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: boolean("emailVerified").notNull().default(false),
    image: text("image"),
    createdAt: providerTimestamp("createdAt").notNull(),
    updatedAt: providerTimestamp("updatedAt").notNull(),
  },
  (table) => [uniqueIndex("auth_user_email_uidx").on(table.email)],
);

export const authSession = appSchema.table(
  authTableNames.session,
  {
    id: providerId,
    expiresAt: providerTimestamp("expiresAt").notNull(),
    token: text("token").notNull(),
    createdAt: providerTimestamp("createdAt").notNull(),
    updatedAt: providerTimestamp("updatedAt").notNull(),
    ipAddress: text("ipAddress"),
    userAgent: text("userAgent"),
    userId: text("userId").notNull().references(() => authUser.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("auth_session_token_uidx").on(table.token),
    index("auth_session_userId_idx").on(table.userId),
  ],
);

export const authAccount = appSchema.table(
  authTableNames.account,
  {
    id: providerId,
    issuer: text("issuer").notNull(),
    // 외부 provider의 subject는 이 열에만 남는다. `auth_user.id`는 provider가 아니라 Better Auth가
    // 새로 만든 내부 값이므로 Google sub와 같다고 보면 안 된다.
    accountId: text("accountId").notNull(),
    providerId: text("providerId").notNull(),
    userId: text("userId").notNull().references(() => authUser.id, { onDelete: "cascade" }),
    accessToken: text("accessToken"),
    refreshToken: text("refreshToken"),
    idToken: text("idToken"),
    accessTokenExpiresAt: providerTimestamp("accessTokenExpiresAt"),
    refreshTokenExpiresAt: providerTimestamp("refreshTokenExpiresAt"),
    scope: text("scope"),
    password: text("password"),
    createdAt: providerTimestamp("createdAt").notNull(),
    updatedAt: providerTimestamp("updatedAt").notNull(),
  },
  (table) => [
    uniqueIndex("auth_account_issuer_accountId_uidx").on(table.issuer, table.accountId),
    index("auth_account_userId_idx").on(table.userId),
  ],
);

export const authVerification = appSchema.table(
  authTableNames.verification,
  {
    id: providerId,
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: providerTimestamp("expiresAt").notNull(),
    createdAt: providerTimestamp("createdAt").notNull(),
    updatedAt: providerTimestamp("updatedAt").notNull(),
  },
  (table) => [index("auth_verification_identifier_idx").on(table.identifier)],
);

export const authRateLimit = appSchema.table(
  authTableNames.rateLimit,
  {
    id: providerId,
    key: text("key").notNull(),
    count: integer("count").notNull(),
    // 밀리초 epoch이라 int4로는 넘치고, JavaScript number mode는 저장소 전역의 bigint 정밀도 규칙을 깬다.
    // provider의 rate limiter는 읽어 온 값이 bigint면 스스로 Number로 바꾸므로 bigint mode로 둔다.
    lastRequest: bigint("lastRequest", { mode: "bigint" }).notNull(),
  },
  (table) => [uniqueIndex("auth_rate_limit_key_uidx").on(table.key)],
);

/** adapter가 `schema[modelName]`으로 표를 찾으므로 key는 반드시 modelName이어야 한다. */
export const authProviderTables = {
  [authTableNames.account]: authAccount,
  [authTableNames.rateLimit]: authRateLimit,
  [authTableNames.session]: authSession,
  [authTableNames.user]: authUser,
  [authTableNames.verification]: authVerification,
} as const;
