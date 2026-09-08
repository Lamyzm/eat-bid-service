/**
 * @module 책임: provider가 만드는 auth table의 이름과 저장 정책처럼 DDL 모양을 결정하는 Better Auth
 * option만 소유해 runtime 조립과 schema conformance 검사가 같은 값 하나를 읽게 한다.
 *
 * 이 값을 server 쪽에 두면 DDL 권위(`packages/db`)와 표 이름을 정하는 설정이 서로 다른 package에 살고,
 * 둘이 갈라지는 순간 검사는 통과하는데 운영 adapter가 없는 표를 찾는다.
 */

/**
 * provider 소유 표에 `auth_` 접두사를 둔다. Better Auth 기본 이름은 `user`·`session`처럼 SQL 예약어이거나
 * 업무 표와 구분되지 않는 일반명사라, 같은 `app` schema에서 우리 표와 섞여 읽힌다.
 */
export const authTableNames = {
  account: "auth_account",
  rateLimit: "auth_rate_limit",
  session: "auth_session",
  user: "auth_user",
  verification: "auth_verification",
} as const;

/**
 * 표 목록과 열 구성을 바꾸는 option만 여기 담는다. secret·baseURL·social provider 자격처럼 schema에
 * 영향이 없는 값은 runtime 환경 경계가 소유한다.
 *
 * `rateLimit.storage: "database"`는 auth brute-force 보호를 memory가 아닌 표로 옮긴다(ADR 0018).
 * 이 값을 지우면 표 하나가 통째로 사라지므로 migration 없이 바꿀 수 없다.
 */
export const authSchemaOptions = {
  account: { modelName: authTableNames.account },
  rateLimit: { modelName: authTableNames.rateLimit, storage: "database" },
  session: { modelName: authTableNames.session },
  user: { modelName: authTableNames.user },
  verification: { modelName: authTableNames.verification },
} as const;

/**
 * Drizzle adapter 설정 중 표 모양을 정하는 값이다.
 *
 * `schemaName`과 `camelCase`는 runtime 질의에는 쓰이지 않고 pinned CLI가 schema를 만들 때만 읽는다.
 * 그래도 runtime과 생성이 같은 객체를 쓰게 두는 이유는, 생성기에만 다른 값을 주면 대조는 통과하는데
 * 실제로 배포되는 표와 다른 모양을 검증하게 되기 때문이다. `camelCase: true`가 없으면 생성기가 provider
 * field 이름을 snake_case로 바꿔 adapter가 찾는 열 이름과 어긋난다.
 */
export const authAdapterOptions = {
  provider: "pg",
  schemaName: "app",
  camelCase: true,
  usePlural: false,
  // provider가 사용자와 계정을 한 단위로 만들 때 그 둘이 함께 커밋되거나 함께 사라지게 한다.
  transaction: true,
} as const;
