/**
 * @module 책임: 등록 사업자 단건 조회 port를 호출자가 연 읽기 스냅샷 위의 소유 확인과 기존 원본 대조
 * 질의로 구현한다.
 *
 * 대조 질의를 다시 쓰지 않고 `readBusinesses`를 그대로 부른다. 사업자번호 두 표기를 정확한 값으로
 * 열거하는 규칙이 두 곳에 살면 한쪽만 바뀌는 순간 같은 등록이 화면마다 다른 party에 연결된다.
 */
import { sql } from "drizzle-orm";
import type {
  RegisteredBusinessLookup,
  RegisteredBusinessLookupInput,
  RegisteredBusinessReader,
} from "../../application/registered-business-reader";
import { transactionDatabase, type TransactionHandle } from "../../../../platform/database/unit-of-work";
import { identifier, rows, type AccountDatabase } from "./account-sql";
import { readBusinesses } from "./registered-business-queries";

type OwnershipRow = Readonly<{ workspace_id: string | bigint }>;

export class DrizzleRegisteredBusinessReader implements RegisteredBusinessReader {
  async find(snapshot: TransactionHandle, input: RegisteredBusinessLookupInput): Promise<RegisteredBusinessLookup> {
    const database = transactionDatabase(snapshot) as AccountDatabase;
    // 소유를 먼저 워크스페이스 조건 없이 확인해야 "없는 등록"과 "남의 등록"이 같은 빈 결과로 뭉개지지
    // 않는다. 회수된 등록은 없는 등록과 같게 다룬다 — 회수 뒤에도 기준으로 남으면 회수가 뜻이 없다.
    const owner = rows<OwnershipRow>(await database.execute(sql`
      select workspace_id
      from app.registered_business
      where registered_business_id = ${input.registeredBusinessId}
        and revoked_at is null
    `))[0];
    if (!owner) return { kind: "not-found" };
    if (identifier(owner.workspace_id) !== input.workspaceId) return { kind: "forbidden" };

    const [business] = await readBusinesses(database, input.workspaceId, input.registeredBusinessId);
    // 같은 스냅샷 안에서 소유를 확인한 등록이 사라질 수 없다. 사라졌다면 스냅샷 가정이 깨진 것이다.
    if (!business) throw new TypeError("Registered business disappeared inside its own snapshot");
    // 증거 불일치는 저장소 장애가 아니라 원본이 말해 주지 않는 사실이다. 호출자가 응답의 구분되는
    // 상태로 옮길 수 있도록 값으로 돌려준다.
    if (business.supplier.kind === "evidence-conflict") return { kind: "evidence-conflict" };
    return { kind: "found", business };
  }
}
