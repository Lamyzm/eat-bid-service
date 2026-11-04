import { describe, expect, test } from "bun:test";

import { withAccountDatabase } from "../../fixtures/account.fixture";

// 지역·품목 코드는 테스트가 고정 id로 심는다(공용 fixture는 기준 어휘를 심지 않는다).
const seedCodes = `
  insert into core.code_scheme (code_scheme_id, namespace, owner, version_policy, valid_time_policy)
  overriding system value values
    (9100000000000001, 'eat:participation-area', 'eat', 'source-versioned', 'observed'),
    (9100000000000002, 'eat:item', 'eat', 'source-versioned', 'observed');
  insert into core.code_value (code_value_id, code_scheme_id, code)
  overriding system value values
    (9100000000000011, 9100000000000001, '김해시'),
    (9100000000000021, 9100000000000002, '축산물'),
    (9100000000000022, 9100000000000002, '수산물');
`;
const gimhae = "9100000000000011";
const meat = "9100000000000021";
const fish = "9100000000000022";

type Sql = { unsafe: (query: string) => Promise<Array<Record<string, unknown>>> };

async function createWorkspace(api: Sql, name: string): Promise<string> {
  const [row] = await api.unsafe(`insert into app.workspace (name) values ('${name}') returning workspace_id::text as id`);
  return String(row!.id);
}

function seat(workspaceId: string, item: string, startsAt: string, endsAt: string, state = "active"): string {
  return `
    insert into app.market_seat (workspace_id, region_code_value_id, item_code_value_id, state, starts_at, ends_at, priority_started_at)
    values (${workspaceId}, ${gimhae}, ${item}, '${state}', '${startsAt}', '${endsAt}', '${startsAt}')
    returning market_seat_id::text as id
  `;
}

function claim(workspaceId: string, startsAt: string, endsAt: string): string {
  return `
    insert into app.seat_business_claim (workspace_id, business_number, starts_at, ends_at)
    values (${workspaceId}, '2482400480', '${startsAt}', '${endsAt}')
  `;
}

async function rejectionCode(work: Promise<unknown>): Promise<string | undefined> {
  try {
    await work;
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

describe("시장 자리 표의 겹침 제약", () => {
  test("같은 자리의 기간 겹침과 같은 사업자번호의 두 워크스페이스는 API 역할이 써도 PostgreSQL이 거부한다", async () => {
    await withAccountDatabase(async ({ owner, api }) => {
      await owner.unsafe(seedCodes);
      const first = await createWorkspace(api, "오뚜기축산");
      const second = await createWorkspace(api, "동원축산");

      await api.unsafe(seat(first, meat, "2026-11-01T15:00:00Z", "2027-02-01T15:00:00Z"));
      // 같은 자리에 하루라도 겹치면 상태가 선점이어도 거부된다(23P01 exclusion_violation).
      expect(await rejectionCode(api.unsafe(seat(second, meat, "2027-02-01T14:00:00Z", "2027-02-01T14:15:00Z", "held"))))
        .toBe("23P01");
      // 끝과 시작이 같은 시각이면 맞닿을 뿐이라 들어간다 — 기간은 반열림 [시작, 끝)이다.
      await api.unsafe(seat(second, meat, "2027-02-01T15:00:00Z", "2027-02-01T15:15:00Z", "held"));
      // 품목이 다르면 다른 시장이다.
      await api.unsafe(seat(second, fish, "2026-11-01T15:00:00Z", "2027-02-01T15:00:00Z"));
      // 회수·취소는 끝을 자르는 것이다. 시작에서 자른 빈 기간은 아무것과도 겹치지 않는다.
      const [held] = await api.unsafe(seat(first, fish, "2027-03-01T00:00:00Z", "2027-03-01T00:15:00Z", "held"));
      await api.unsafe(`update app.market_seat set ends_at = starts_at where market_seat_id = ${String(held!.id)}`);
      await api.unsafe(seat(second, fish, "2027-02-01T15:00:00Z", "2027-04-01T15:00:00Z"));

      await api.unsafe(claim(first, "2026-11-01T15:00:00Z", "2027-02-01T15:00:00Z"));
      // 같은 워크스페이스가 자리 둘로 같은 번호를 겹쳐 쓰는 것은 정상이다.
      await api.unsafe(claim(first, "2026-12-01T15:00:00Z", "2027-03-01T15:00:00Z"));
      expect(await rejectionCode(api.unsafe(claim(second, "2027-02-28T15:00:00Z", "2027-03-02T15:00:00Z")))).toBe("23P01");
      await api.unsafe(claim(second, "2027-03-01T15:00:00Z", "2027-06-01T15:00:00Z"));

      // 다음 마이그레이션이 제약을 지우지 않았는지: 커밋된 마이그레이션을 모두 적용한 뒤에도 둘 다 exclusion으로 남아 있다.
      const constraints = await owner.unsafe(`
        select conname from pg_constraint
         where contype = 'x' and connamespace = 'app'::regnamespace
         order by conname
      `);
      expect(constraints.map((row) => row.conname)).toEqual(["market_seat_no_overlap", "seat_business_claim_one_workspace"]);

      // 운영 마이그레이션은 superuser가 아니라 migrator가 돈다. 운영이 손으로 준 database CREATE만 있으면 신뢰 확장인
      // btree_gist를 만들 수 있는지 되돌리는 transaction 안에서 확인한다.
      const migratorCreated = await owner.begin(async (transaction) => {
        await transaction.unsafe(`drop extension btree_gist cascade`);
        await transaction.unsafe(`grant create on database ${String((await transaction.unsafe("select current_database() as db"))[0]!.db)} to eatbid_migrator`);
        await transaction.unsafe(`set local role eatbid_migrator`);
        await transaction.unsafe(`create extension btree_gist with schema app`);
        const [row] = await transaction.unsafe(`select count(*)::int as count from pg_extension where extname = 'btree_gist'`);
        throw Object.assign(new Error("rollback"), { observed: row!.count });
      }).catch((error: { observed?: number }) => error.observed);
      expect(migratorCreated).toBe(1);
    });
  }, 120_000);

  test("공고마다 지금 맡은 줄은 하나뿐이고, 넘김은 이전 줄을 닫은 뒤 더하며, 사람의 정정은 이유 없이 남지 않는다", async () => {
    await withAccountDatabase(async ({ owner, api }) => {
      await owner.unsafe(seedCodes);
      const first = await createWorkspace(api, "오뚜기축산");
      const second = await createWorkspace(api, "동원축산");
      const [firstSeat] = await api.unsafe(seat(first, meat, "2026-11-01T15:00:00Z", "2027-02-01T15:00:00Z"));
      const [secondSeat] = await api.unsafe(seat(second, fish, "2026-11-01T15:00:00Z", "2027-02-01T15:00:00Z"));
      const firstSeatId = String(firstSeat!.id);
      const secondSeatId = String(secondSeat!.id);
      const take = (workspaceId: string, seatId: string, kind = "took") => `
        insert into app.auction_amount_assignment
          (auction_attempt_id, workspace_id, market_seat_id, kind, basis_observation_id, rule_version,
           candidate_market_seat_ids, recorded_at)
        values (501, ${workspaceId}, ${seatId}, '${kind}', 9001, 'seat-r1',
                array[${firstSeatId}, ${secondSeatId}]::bigint[], '2026-11-05T01:00:00Z')
        on conflict (auction_attempt_id) where superseded_at is null do nothing
        returning auction_amount_assignment_id::text as id
      `;

      // 동시 요청 둘 중 늦은 쪽은 아무것도 쓰지 못하고, 다시 읽으면 먼저 맡은 업체가 보인다.
      const [taken] = await api.unsafe(take(first, firstSeatId));
      expect(await api.unsafe(take(second, secondSeatId))).toEqual([]);
      expect(await api.unsafe(`
        select workspace_id::text as workspace from app.auction_amount_assignment
         where auction_attempt_id = 501 and superseded_at is null
      `)).toEqual([{ workspace: first }]);

      // 자리가 끝나 다음 후보가 맡을 때는 이전 줄을 닫고 새 줄을 더한다. 이전 줄은 지우지 않는다.
      await api.unsafe(`
        update app.auction_amount_assignment set superseded_at = '2026-11-06T00:00:00Z'
         where auction_amount_assignment_id = ${String(taken!.id)}
      `);
      expect(await api.unsafe(take(second, secondSeatId, "handed_over"))).toHaveLength(1);
      expect(await api.unsafe(`select count(*)::int as count from app.auction_amount_assignment`)).toEqual([{ count: 2 }]);

      // 후보 목록에 없는 자리로 맡을 수 없다.
      const [stray] = await api.unsafe(seat(first, fish, "2027-03-01T00:00:00Z", "2027-04-01T00:00:00Z"));
      expect(await rejectionCode(api.unsafe(`
        insert into app.auction_amount_assignment
          (auction_attempt_id, workspace_id, market_seat_id, kind, basis_observation_id, rule_version,
           candidate_market_seat_ids, recorded_at)
        values (502, ${first}, ${String(stray!.id)}, 'took', 9002, 'seat-r1', array[${firstSeatId}]::bigint[], now())
      `))).toBe("23514");
      // 운영자 정정은 사람과 이유가 함께 있어야 한다.
      expect(await rejectionCode(api.unsafe(`
        insert into app.auction_amount_assignment
          (auction_attempt_id, workspace_id, market_seat_id, kind, basis_observation_id, rule_version,
           candidate_market_seat_ids, recorded_at)
        values (503, ${first}, ${firstSeatId}, 'corrected', 9003, 'seat-r1', array[${firstSeatId}]::bigint[], now())
      `))).toBe("23514");
    });
  }, 120_000);
});
