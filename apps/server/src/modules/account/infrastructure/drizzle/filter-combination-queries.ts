/**
 * @module 책임: 저장된 조건 조합의 조회·저장·삭제를 워크스페이스 경계 안에서, 상한 판정과 같은 트랜잭션으로 수행한다.
 */
import { auctionItemAtomSchema, CODE_SCHEME_NAMES, maxFilterCombinations } from "@eatbid/contracts";
import { sql } from "drizzle-orm";

import type {
  DeleteFilterCombinationResult,
  FilterCombinationFilterRecord,
  FilterCombinationRecord,
  SaveFilterCombinationInput,
  SaveFilterCombinationResult,
} from "../../application/filter-combination-repository";
import { bigintArrayLiteral, textArrayLiteral } from "../../../../platform/database/sql-values";
import { UTC_INSTANT_FORMAT, identifier, instantOf, rows, type AccountDatabase } from "./account-sql";

type CombinationRow = Readonly<{
  filter_combination_id: string | bigint;
  name: string;
  sido_code_value_id: string | bigint | null;
  base_amount_min: string | null;
  base_amount_max: string | null;
  created_at: string;
  sigungu: readonly (string | number)[] | null;
  items: readonly string[] | null;
}>;

function toCombination(row: CombinationRow): FilterCombinationRecord {
  return {
    filterCombinationId: identifier(row.filter_combination_id),
    name: row.name,
    filter: {
      sidoCodeValueId: row.sido_code_value_id === null ? null : identifier(row.sido_code_value_id),
      // jsonb 배열이 비면 null로 오므로 여기서 한 번만 편다. 빈 배열과 null은 같은 뜻이다 — 안 골랐다.
      sigunguCodeValueIds: (row.sigungu ?? []).map((value) => identifier(String(value))),
      // 저장이 FK로 닫혀 있어 코드는 어휘 안이지만, wire enum으로 좁히는 것은 이 경계가 한 번만 한다.
      itemAtoms: (row.items ?? []).map((code) => auctionItemAtomSchema.parse(code)),
      baseAmountMin: row.base_amount_min,
      baseAmountMax: row.base_amount_max,
    },
    createdAt: instantOf(row.created_at),
  };
}

/**
 * 자식 둘을 jsonb로 접어 한 왕복에 받는다. 조합마다 자식을 다시 조회하면 다섯 조합에 열한 번이 되고,
 * 그 열하나가 서로 다른 시점의 저장 상태를 볼 수 있다.
 *
 * 워크스페이스 경계는 `where` 하나가 지킨다. RLS가 없으므로 조회마다 명시적으로 건다.
 */
export async function listCombinations(
  database: AccountDatabase,
  workspaceId: bigint,
): Promise<readonly FilterCombinationRecord[]> {
  const result = await database.execute(sql`
    select combination.filter_combination_id,
           combination.name,
           combination.sido_code_value_id,
           combination.base_amount_min::text as base_amount_min,
           combination.base_amount_max::text as base_amount_max,
           to_char(combination.created_at at time zone 'UTC', ${UTC_INSTANT_FORMAT}) as created_at,
           (select jsonb_agg(sigungu.code_value_id order by sigungu.code_value_id)
              from app.workspace_filter_combination_sigungu sigungu
             where sigungu.filter_combination_id = combination.filter_combination_id) as sigungu,
           -- 저장은 code value id이고 화면이 받는 값은 그 코드(원자 글자)다. 조인해서 코드로 되돌린다.
           (select jsonb_agg(value.code order by value.code)
              from app.workspace_filter_combination_item item
              join core.code_value value on value.code_value_id = item.item_code_value_id
             where item.filter_combination_id = combination.filter_combination_id) as items
      from app.workspace_filter_combination combination
     where combination.workspace_id = ${workspaceId}
     order by combination.created_at, combination.filter_combination_id
  `);
  return rows<CombinationRow>(result).map(toCombination);
}

async function insertChildren(
  database: AccountDatabase,
  filterCombinationId: bigint,
  filter: FilterCombinationFilterRecord,
): Promise<void> {
  if (filter.sigunguCodeValueIds.length > 0) {
    await database.execute(sql`
      insert into app.workspace_filter_combination_sigungu (filter_combination_id, code_value_id)
      select ${filterCombinationId}, code_value_id
        from unnest(${bigintArrayLiteral(filter.sigunguCodeValueIds)}::bigint[]) as code_value_id
    `);
  }
  if (filter.itemAtoms.length > 0) {
    // 원자 글자를 그대로 저장하지 않고 `eatbid:auction-item` 체계의 code value id로 닫는다(AGENTS 2).
    // 계약이 어휘 밖 값을 이미 거절하므로 조인이 비는 것은 시드가 안 돈 DB뿐이다.
    await database.execute(sql`
      insert into app.workspace_filter_combination_item (filter_combination_id, item_code_value_id)
      select ${filterCombinationId}, value.code_value_id
        from unnest(${textArrayLiteral(filter.itemAtoms)}::text[]) as atom(code)
        join core.code_value value on value.code = atom.code
        join core.code_scheme scheme
          on scheme.code_scheme_id = value.code_scheme_id
         and scheme.namespace = ${CODE_SCHEME_NAMES.auctionItem}
    `);
  }
}

/**
 * 상한과 이름 중복을 **같은 트랜잭션 안에서** 판정한다. 밖에서 세고 들어오면 두 요청이 동시에 다섯째
 * 자리를 보고 여섯이 저장된다. 그 뒤 조회는 상한 다섯짜리 응답 배열에서 거부되어 사용자가 정상 상태를
 * 아예 못 읽게 된다.
 *
 * 세는 행에 잠금을 건다. `count`만으로는 동시에 읽은 두 트랜잭션이 둘 다 넷을 보고 통과한다.
 */
export async function saveCombination(
  database: AccountDatabase,
  input: SaveFilterCombinationInput,
): Promise<SaveFilterCombinationResult> {
  return await database.transaction(async (transaction) => {
    // 이 워크스페이스의 조합 행을 먼저 잠근다. 워크스페이스 단위라 경합 범위가 그 워크스페이스에 갇힌다.
    const existing = rows<{ filter_combination_id: string | bigint; name: string }>(
      await transaction.execute(sql`
        select filter_combination_id, name
          from app.workspace_filter_combination
         where workspace_id = ${input.workspaceId}
           for update
      `),
    );
    if (existing.length >= maxFilterCombinations) return { kind: "limit-reached" as const };
    if (existing.some((row) => row.name === input.name)) return { kind: "duplicate-name" as const };

    const inserted = rows<CombinationRow>(await transaction.execute(sql`
      insert into app.workspace_filter_combination
        (workspace_id, name, sido_code_value_id, base_amount_min, base_amount_max, created_by_principal_id)
      values (${input.workspaceId}, ${input.name}, ${input.filter.sidoCodeValueId},
              ${input.filter.baseAmountMin}::numeric, ${input.filter.baseAmountMax}::numeric,
              ${input.principalId})
      returning filter_combination_id, name, sido_code_value_id,
                base_amount_min::text as base_amount_min,
                base_amount_max::text as base_amount_max,
                to_char(created_at at time zone 'UTC', ${UTC_INSTANT_FORMAT}) as created_at
    `));
    const row = inserted[0];
    if (row === undefined) throw new Error("Filter combination insert returned no row");
    const filterCombinationId = identifier(row.filter_combination_id);
    await insertChildren(transaction, filterCombinationId, input.filter);
    return {
      kind: "saved" as const,
      combination: toCombination({
        ...row,
        sigungu: input.filter.sigunguCodeValueIds.map((value) => value.toString(10)),
        items: input.filter.itemAtoms,
      }),
    };
  });
}

/**
 * 워크스페이스 경계가 `where`에 함께 있다. 남의 조합은 행이 안 잡혀 "없다"가 되며, 자식은 FK의
 * `on delete cascade`가 지운다.
 */
export async function deleteCombination(
  database: AccountDatabase,
  input: { readonly workspaceId: bigint; readonly filterCombinationId: bigint },
): Promise<DeleteFilterCombinationResult> {
  const deleted = rows<{ filter_combination_id: string | bigint }>(await database.execute(sql`
    delete from app.workspace_filter_combination
     where workspace_id = ${input.workspaceId}
       and filter_combination_id = ${input.filterCombinationId}
    returning filter_combination_id
  `));
  return deleted.length > 0 ? { kind: "deleted" } : { kind: "not-found" };
}
