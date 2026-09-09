/**
 * @module 책임: 커밋된 Drizzle auth schema를 Better Auth adapter와 schema option으로 묶어 인증 조립에 넘긴다.
 *
 * 이 파일이 `platform/database`에 있는 이유는 저장소를 아는 코드의 자리가 여기 하나이기 때문이다.
 * 인증 정책과 transport는 adapter를 주입받기만 하고 표도 driver도 알지 않는다.
 */
import { authAdapterOptions, authProviderTables, authSchemaOptions } from "@eatbid/db";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { AuthDatabaseBinding } from "../auth/auth-database";
import type { ManagedDatabase } from "./managed-database";

export function createAuthDatabaseBinding(connection: ManagedDatabase): AuthDatabaseBinding {
  return {
    // adapter는 `schema[modelName]`으로 표를 찾으므로 key가 곧 물리 table 이름이어야 한다.
    adapter: drizzleAdapter(connection.database, {
      ...authAdapterOptions,
      schema: { ...authProviderTables },
    }),
    schemaOptions: authSchemaOptions,
  };
}
