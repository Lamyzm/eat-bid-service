/**
 * @module 책임: 워크스페이스 관심 지역의 조회와 통째 교체를 워크스페이스 경계 안에서, 체계 검증과 같은
 * 트랜잭션으로 수행한다.
 */
import { CODE_SCHEME_NAMES } from "@eatbid/contracts";
import { sql } from "drizzle-orm";

import type {
  RegionPreferenceAreaRecord,
  RegionPreferenceRecord,
  ReplaceRegionPreferenceInput,
  ReplaceRegionPreferenceResult,
} from "../../application/region-preference-repository";
import { bigintArrayLiteral } from "../../../../platform/database/sql-values";
import { UTC_INSTANT_FORMAT, identifier, instantOf, rows, type AccountDatabase } from "./account-sql";

type AreaRow = Readonly<{
  code_value_id: string | bigint;
  code: string;
  scheme: string;
  label: string | null;
}>;

type ConfirmationRow = Readonly<{ confirmed_at: string }>;

function toArea(row: AreaRow): RegionPreferenceAreaRecord {
  return {
    codeValueId: identifier(row.code_value_id),
    code: row.code,
    scheme: row.scheme,
    // 빈 문자열 라벨은 관측이 아니다. 없는 것과 같이 다룬다.
    label: row.label === null || row.label.trim() === "" ? null : row.label.trim(),
  };
}

/**
 * 워크스페이스 경계는 여기 `where` 하나가 지킨다. RLS가 없으므로 조회마다 명시적으로 건다 —
 * 남의 워크스페이스 지역은 이 술어 때문에 애초에 행으로 나오지 않는다.
 */
async function readAreas(
  database: AccountDatabase,
  workspaceId: bigint,
): Promise<readonly RegionPreferenceAreaRecord[]> {
  const result = await database.execute(sql`
    select code.code_value_id,
           code.code,
           scheme.namespace as scheme,
           (select observation.label
              from core.code_label_observation observation
             where observation.code_value_id = code.code_value_id
             order by observation.observed_at desc, observation.code_label_observation_id desc
             limit 1) as label
      from app.workspace_region_preference_area selection
      join core.code_value code on code.code_value_id = selection.code_value_id
      join core.code_scheme scheme on scheme.code_scheme_id = code.code_scheme_id
     where selection.workspace_id = ${workspaceId}
     order by code.code
  `);
  return rows<AreaRow>(result).map(toArea);
}

export async function readPreference(
  database: AccountDatabase,
  workspaceId: bigint,
): Promise<RegionPreferenceRecord> {
  const confirmation = rows<ConfirmationRow>(await database.execute(sql`
    select to_char(preference.confirmed_at at time zone 'utc', ${UTC_INSTANT_FORMAT}) as confirmed_at
      from app.workspace_region_preference preference
     where preference.workspace_id = ${workspaceId}
  `))[0];
  // 확인 행이 없으면 선택 행도 있을 수 없다(FK). 그래도 목록을 따로 읽지 않는 편이 왕복 하나를 줄인다.
  if (confirmation === undefined) return { areas: [], confirmedAt: null };
  return { areas: await readAreas(database, workspaceId), confirmedAt: instantOf(confirmation.confirmed_at) };
}

/**
 * 교체와 확인 도장을 한 트랜잭션으로 묶는다. 지우고 넣는 사이에 다른 요청이 끼어들면 목록이 반쪽으로
 * 보이므로 워크스페이스 행을 먼저 잠근다.
 *
 * 체계 검증을 지우기 전에 하는 이유는 거절이 아무것도 바꾸지 않아야 하기 때문이다. 참가제한지역 체계에
 * 실제로 있는 코드 수가 요청한 수와 다르면 그대로 돌아가며, 아는 코드만 골라 저장하지 않는다 — 그러면
 * 사용자가 화면에서 본 선택과 저장된 선택이 조용히 달라진다.
 */
export async function replacePreference(
  database: AccountDatabase,
  input: ReplaceRegionPreferenceInput,
): Promise<ReplaceRegionPreferenceResult> {
  const requested = bigintArrayLiteral(input.codeValueIds);
  const requestedCount = input.codeValueIds.length;
  return database.transaction(async (transaction) => {
    const workspace = rows<{ workspace_id: string | bigint }>(await transaction.execute(sql`
      select workspace_id from app.workspace where workspace_id = ${input.workspaceId} for update
    `))[0];
    if (!workspace) throw new TypeError("Workspace disappeared before saving region preference");

    const known = rows<{ known_count: number }>(await transaction.execute(sql`
      select count(*)::int as known_count
        from core.code_value code
        join core.code_scheme scheme
          on scheme.code_scheme_id = code.code_scheme_id
         and scheme.namespace = ${CODE_SCHEME_NAMES.eligibilityArea}
       where code.code_value_id = any(${requested}::bigint[])
    `))[0];
    if ((known?.known_count ?? 0) !== requestedCount) return { kind: "unknown-area" };

    await transaction.execute(sql`
      insert into app.workspace_region_preference (workspace_id, confirmed_at, confirmed_by_principal_id)
      values (${input.workspaceId}, now(), ${input.principalId})
      on conflict (workspace_id) do update
        set confirmed_at = now(),
            confirmed_by_principal_id = excluded.confirmed_by_principal_id
    `);
    await transaction.execute(sql`
      delete from app.workspace_region_preference_area where workspace_id = ${input.workspaceId}
    `);

    if (requestedCount > 0) {
      await transaction.execute(sql`
        insert into app.workspace_region_preference_area (workspace_id, code_value_id)
        select ${input.workspaceId}, code.code_value_id
          from core.code_value code
         where code.code_value_id = any(${requested}::bigint[])
      `);
    }

    return { kind: "replaced", preference: await readPreference(transaction, input.workspaceId) };
  });
}
