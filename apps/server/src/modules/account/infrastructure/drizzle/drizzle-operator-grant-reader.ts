/** @module 책임: 운영자 권한 port를 `app.operator_grant`의 회수되지 않은 행 하나로 판정하는 Drizzle adapter를 소유한다. */
import { sql } from "drizzle-orm";

import type { OperatorGrantReader } from "../../../../platform/auth/operator-grant-reader";
import { rows, type AccountDatabase } from "./account-sql";

export class DrizzleOperatorGrantReader implements OperatorGrantReader {
  constructor(private readonly database: AccountDatabase) {}

  async hasActiveGrant(principalId: bigint): Promise<boolean> {
    // 회수 여부만 본다. 부여 시각이 미래인 행은 만들 수 없고(기본값 now), 회수는 행을 지우지 않고 시각을 채운다.
    const result = await this.database.execute(sql`
      select 1 as present
      from app.operator_grant
      where principal_id = ${principalId}
        and revoked_at is null
      limit 1
    `);
    return rows<{ present: number }>(result).length > 0;
  }
}
