/**
 * @module 책임: 워크스페이스가 등록한 사업자의 조회·등록·위치 변경을 소유 확인과 같은 트랜잭션 안에서 수행한다.
 *
 * `core` 연결은 저장하지 않고 읽을 때마다 정확 대조로 파생한다. 그래야 나중에 원본이 그 사업자를 처음
 * 관측해도 같은 등록이 저절로 연결된다(ADR 0032 §7).
 */
import { sql, type SQL } from "drizzle-orm";
import { maxRegisteredBusinesses } from "@eatbid/contracts";
import type {
  ChangeLocationInput,
  ChangeLocationResult,
  RegisterBusinessInput,
  RegisterBusinessResult,
  RegisteredBusinessRecord,
  RegisteredSupplierEvidence,
} from "../../application/account-repository";
import {
  BUSINESS_NUMBER_SCHEME,
  UTC_INSTANT_FORMAT,
  identifier,
  instantOf,
  rows,
  type AccountDatabase,
} from "./account-sql";

type BusinessRow = Readonly<{
  registered_business_id: string | bigint;
  business_number: string;
  registered_at: string;
  supplier_party_id: string | bigint | null;
  /** 같은 번호를 가리키는 서로 다른 party 수다. 1이 아니면 연결을 고르지 않는다. */
  supplier_party_count: string | bigint | number;
  address_text: string | null;
  location_updated_at: string | null;
}>;

type OwnershipRow = Readonly<{ workspace_id: string | bigint }>;

/**
 * 원본이 관측한 사업자번호 코드는 하이픈 없는 열 자리로 오지만 소스가 그 표기를 보장하지는 않는다.
 * 두 표기를 정확한 값으로 열거해 대조하면 `code_value_scheme_code_key` index를 그대로 쓰면서도 표기
 * 차이 하나로 모든 등록이 미관측이 되는 일을 막는다. 유사도나 부분 일치로 넓히지는 않는다.
 */
const businessNumberCandidates = sql`(
  registration.business_number::text,
  substr(registration.business_number::text, 1, 3) || '-'
    || substr(registration.business_number::text, 4, 2) || '-'
    || substr(registration.business_number::text, 6, 5)
)`;

/**
 * 한 번호가 서로 다른 party 둘을 가리키면 어느 쪽이 이 사업자인지 원본이 말해 주지 않는다. 하나를 골라
 * 연결하면 남의 성적표를 내 것으로 붙이는 일이고, 미관측으로 낮추면 있는 증거를 감춘다. 자동 병합은
 * `code_mapping`과 같은 급의 명시적 reconciliation이므로(ADR 0033 §1) 여기서는 그 사실을 상태로 돌려준다.
 * 예외로 던지면 등록 하나가 갈리는 순간 워크스페이스의 목록 전체가 닫힌다.
 */
function supplierOf(row: BusinessRow): RegisteredSupplierEvidence {
  const partyCount = Number(row.supplier_party_count);
  if (Number.isFinite(partyCount) && partyCount > 1) return { kind: "evidence-conflict" };
  if (row.supplier_party_id === null) return { kind: "unobserved" };
  return { kind: "linked", supplierPartyId: identifier(row.supplier_party_id) };
}

function toBusiness(row: BusinessRow): RegisteredBusinessRecord {
  return {
    registeredBusinessId: identifier(row.registered_business_id),
    businessNumber: row.business_number,
    registeredAt: instantOf(row.registered_at),
    supplier: supplierOf(row),
    location: row.address_text === null || row.location_updated_at === null
      ? null
      : { addressText: row.address_text, updatedAt: instantOf(row.location_updated_at) },
  };
}

/**
 * 한 등록만 필요할 때 목록 전체를 읽지 않는다. 다른 등록 하나가 모호한 party 증거를 갖고 있으면 그
 * 실패가 지금 바꾼 등록의 응답까지 삼켜, 이미 커밋된 변경을 사용자에게 실패로 보이게 만든다.
 */
export async function readBusinesses(
  database: AccountDatabase,
  workspaceId: bigint,
  registeredBusinessId?: bigint,
): Promise<readonly RegisteredBusinessRecord[]> {
  const scope: SQL = registeredBusinessId === undefined
    ? sql``
    : sql` and registration.registered_business_id = ${registeredBusinessId}`;
  const result = await database.execute(sql`
    select registration.registered_business_id,
           registration.business_number,
           to_char(registration.registered_at at time zone 'utc', ${UTC_INSTANT_FORMAT}) as registered_at,
           party.supplier_party_id,
           party.supplier_party_count,
           location.address_text,
           to_char(location.updated_at at time zone 'utc', ${UTC_INSTANT_FORMAT}) as location_updated_at
    from app.registered_business registration
    left join lateral (
      select count(distinct supplier.supplier_party_id) as supplier_party_count,
             min(supplier.supplier_party_id) as supplier_party_id
      from core.code_scheme scheme
      join core.code_value value
        on value.code_scheme_id = scheme.code_scheme_id
       and value.code in ${businessNumberCandidates}
      join core.supplier_party supplier
        on supplier.business_number_code_value_id = value.code_value_id
      where scheme.namespace = ${BUSINESS_NUMBER_SCHEME}
    ) party on true
    left join app.registered_business_location location
      on location.registered_business_id = registration.registered_business_id
    where registration.workspace_id = ${workspaceId}
      and registration.revoked_at is null${scope}
    order by registration.registered_at, registration.registered_business_id
  `);
  return rows<BusinessRow>(result).map(toBusiness);
}

async function readOne(
  database: AccountDatabase,
  workspaceId: bigint,
  registeredBusinessId: bigint,
): Promise<RegisteredBusinessRecord> {
  const [business] = await readBusinesses(database, workspaceId, registeredBusinessId);
  if (!business) throw new TypeError("Registered business disappeared inside its own transaction");
  return business;
}

export async function registerBusiness(
  database: AccountDatabase,
  input: RegisterBusinessInput,
): Promise<RegisterBusinessResult> {
  return database.transaction(async (transaction) => {
    // 워크스페이스 행을 잠가 같은 워크스페이스의 동시 등록을 직렬화한다. 잠그지 않으면 두 트랜잭션이
    // 서로의 미커밋 행을 보지 못한 채 각각 상한 미만이라고 판단해 상한을 넘겨 저장한다.
    const workspace = rows<OwnershipRow>(await transaction.execute(sql`
      select workspace_id from app.workspace where workspace_id = ${input.workspaceId} for update
    `))[0];
    if (!workspace) throw new TypeError("Workspace disappeared before registration");

    const counted = rows<{ active_count: string | bigint | number }>(await transaction.execute(sql`
      select count(*) as active_count
      from app.registered_business
      where workspace_id = ${input.workspaceId} and revoked_at is null
    `))[0];
    if (Number(counted?.active_count ?? 0) >= maxRegisteredBusinesses) return { kind: "limit-reached" };

    const created = rows<{ registered_business_id: string | bigint }>(await transaction.execute(sql`
      insert into app.registered_business
        (workspace_id, business_number, registered_by_principal_id)
      values (${input.workspaceId}, ${input.businessNumber}, ${input.principalId})
      on conflict do nothing
      returning registered_business_id
    `))[0];
    if (!created) return { kind: "already-registered" };

    return {
      kind: "registered",
      business: await readOne(transaction, input.workspaceId, identifier(created.registered_business_id)),
    };
  });
}

/**
 * 소유 확인·쓰기·응답 조회를 한 트랜잭션에 둔다. 나누면 응답 조회가 실패했을 때 이미 커밋된 변경이
 * 사용자에게는 실패로 보이고, 그 사이 다른 요청이 같은 등록을 바꿀 수도 있다.
 */
export async function changeLocation(
  database: AccountDatabase,
  input: ChangeLocationInput,
): Promise<ChangeLocationResult> {
  return database.transaction(async (transaction) => {
    const owner = rows<OwnershipRow>(await transaction.execute(sql`
      select workspace_id
      from app.registered_business
      where registered_business_id = ${input.registeredBusinessId}
        and revoked_at is null
      for update
    `))[0];
    if (!owner) return { kind: "not-found" };
    if (identifier(owner.workspace_id) !== input.workspaceId) return { kind: "forbidden" };

    if (input.addressText === null) {
      // 미설정은 행이 없는 상태다. 빈 문자열로 덮어쓰면 "적었는데 비어 있다"와 구분되지 않는다.
      await transaction.execute(sql`
        delete from app.registered_business_location
        where registered_business_id = ${input.registeredBusinessId}
      `);
    } else {
      await transaction.execute(sql`
        insert into app.registered_business_location
          (registered_business_id, address_text, updated_by_principal_id)
        values (${input.registeredBusinessId}, ${input.addressText}, ${input.principalId})
        on conflict (registered_business_id) do update
          set address_text = excluded.address_text,
              updated_at = now(),
              updated_by_principal_id = excluded.updated_by_principal_id
      `);
    }
    return {
      kind: "changed",
      business: await readOne(transaction, input.workspaceId, input.registeredBusinessId),
    };
  });
}
