/**
 * @module 책임: provider 인증이 쓰는 저장소 결합을 type으로만 선언해 auth 조립이 Drizzle schema를 직접
 * 알지 않게 한다.
 *
 * 실제 adapter 생성은 `platform/database`가 소유한다. 저장소 접근 지점을 그 경계 하나로 유지해야
 * "DB를 아는 파일"이 늘어나지 않고, DDL 권위 검사도 그 규칙을 그대로 집행할 수 있다.
 */
import type { BetterAuthOptions } from "better-auth";

export interface AuthDatabaseBinding {
  readonly adapter: NonNullable<BetterAuthOptions["database"]>;
  /**
   * 표 이름처럼 DDL 모양을 정하는 option은 `packages/db`가 소유한다. runtime이 다른 값을 쓰면 schema
   * 대조는 통과하는데 adapter가 없는 표를 찾는다.
   */
  readonly schemaOptions: Pick<
    BetterAuthOptions,
    "account" | "rateLimit" | "session" | "user" | "verification"
  >;
}
