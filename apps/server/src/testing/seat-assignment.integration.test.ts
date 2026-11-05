import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import { Effect } from "effect";
import { Temporal, type Clock } from "@eatbid/domain";

import { withAccountDatabase } from "../../fixtures/account.fixture";
import { AssignAuctionAmount } from "../modules/entitlement/application/assign-auction-amount";
import {
  DrizzleSeatAssignmentStore,
  type SeatAssignmentDatabase,
} from "../modules/entitlement/infrastructure/drizzle/drizzle-seat-assignment-store";

const RUN_ID = "00000000-0000-4000-8000-000000000369";
const BLOB = "c".repeat(64);
const AREA_SCHEME = 9200000000000001n;
const ITEM_SCHEME = 9200000000000002n;
const GIMHAE = 9200000000000011n;
const MEAT = 9200000000000021n;
const FISH = 9200000000000022n;
// 두 품목을 함께 내는 공고와, 처음엔 축산만 내다가 정정공고로 수산으로 바뀌는 공고다.
const BOTH = 9200000000000101n;
const CORRECTED = 9200000000000102n;

function revision(id: bigint, attemptId: bigint, observationId: bigint, recordId: bigint, deadline: string): string {
  return `
    insert into ingest.normalized_record
      (normalized_record_id, observation_id, record_type, source_entity_id, normalized_payload, parser_version, normalized_at)
    overriding system value
    values (${recordId}, ${observationId}, 'auction.v2', 'external-${attemptId}-${recordId}', '{}', 'eat-v2', '2026-11-01T00:00:40Z');
    insert into core.auction_revision
      (auction_revision_id, auction_attempt_id, normalized_record_id, observation_id,
       content_sha256, display_bid_no, source_status, title, announced_at, deadline_at,
       opened_at, base_amount, planned_amount, currency, roster_submission_count, source_roster_size, lineage_observed)
    overriding system value
    values (${id}, ${attemptId}, ${recordId}, ${observationId}, '${String(id).padStart(64, "0")}', null, 'OPEN',
      '급식 식재료 구매', '2026-11-01T00:00:00Z', '${deadline}', null, 1000000.00, null, 'KRW', null, null, false);
  `;
}

function observation(id: bigint, fetchedAt: string): string {
  return `
    insert into ingest.raw_observation
      (observation_id, run_id, request_unit_id, source, endpoint, request_params, fetched_at, http_status, content_sha256)
    overriding system value
    values (${id}, '${RUN_ID}', 3369, 'eat', 'bid-list', '{}', '${fetchedAt}', 200, '${BLOB}');
  `;
}

function links(revisionId: bigint, items: readonly bigint[]): string {
  const values = [`(${revisionId}, ${GIMHAE}, 'eligibility_area')`, ...items.map((item) => `(${revisionId}, ${item}, 'item')`)];
  return `insert into core.auction_revision_code_value (auction_revision_id, code_value_id, role) values ${values.join(", ")};`;
}

const seed = `
  insert into core.code_scheme (code_scheme_id, namespace, owner, version_policy, valid_time_policy)
  overriding system value values
    (${AREA_SCHEME}, 'eat:participation-area-test', 'eat', 'source-versioned', 'observed'),
    (${ITEM_SCHEME}, 'eatbid:auction-item-test', 'eatbid', 'source-versioned', 'observed');
  insert into core.code_value (code_value_id, code_scheme_id, code)
  overriding system value values (${GIMHAE}, ${AREA_SCHEME}, '15653'), (${MEAT}, ${ITEM_SCHEME}, '축산'), (${FISH}, ${ITEM_SCHEME}, '수산');
  insert into core.auction_attempt (auction_attempt_id, source_system, external_bid_id)
  overriding system value values (${BOTH}, 'eat', 'external-both'), (${CORRECTED}, 'eat', 'external-corrected');
  insert into ingest.run
    (run_id, mode, status, build_sha, parser_version, started_at, ended_at, failure_category, expected_count, captured_count, published_count)
  values ('${RUN_ID}', 'capture', 'published', '${"a".repeat(64)}', 'eat-v2', '2026-11-01T00:00:00Z', '2026-11-01T00:01:00Z', null, 1, 1, 1);
  insert into ingest.request_unit
    (request_unit_id, run_id, source, endpoint, request_params, request_params_hash, expected_count, observed_count, status)
  overriding system value
  values (3369, '${RUN_ID}', 'eat', 'bid-list', '{}', '${"b".repeat(64)}', 1, 1, 'captured');
  insert into ingest.raw_blob (content_sha256, object_key, byte_length, content_type, content_encoding, stored_at)
  values ('${BLOB}', 'raw/eat/bid-list/${BLOB}.xml.gz', 10, 'application/xml', 'gzip', '2026-11-01T00:00:30Z');
  ${observation(1n, "2026-11-01T00:30:00Z")}
  ${revision(9201n, BOTH, 1n, 9301n, "2026-11-10T02:00:00Z")}
  ${links(9201n, [MEAT, FISH])}
  ${revision(9202n, CORRECTED, 1n, 9302n, "2026-11-10T02:00:00Z")}
  ${links(9202n, [MEAT])}
`;

type Sql = { unsafe: (query: string) => Promise<Array<Record<string, unknown>>> };

async function workspace(api: Sql, name: string): Promise<bigint> {
  const [row] = await api.unsafe(`insert into app.workspace (name) values ('${name}') returning workspace_id::text as id`);
  return BigInt(String(row!.id));
}

async function seat(api: Sql, workspaceId: bigint, item: bigint, priority: string): Promise<bigint> {
  const [row] = await api.unsafe(`
    insert into app.market_seat (workspace_id, region_code_value_id, item_code_value_id, state, starts_at, ends_at, priority_started_at)
    values (${workspaceId}, ${GIMHAE}, ${item}, 'active', '${priority}', '2027-02-01T15:00:00Z', '${priority}')
    returning market_seat_id::text as id
  `);
  return BigInt(String(row!.id));
}

class MovableClock implements Clock {
  constructor(private instant: Temporal.Instant) {}
  now(): Temporal.Instant {
    return this.instant;
  }
  set(value: string): void {
    this.instant = Temporal.Instant.from(value);
  }
}

describe("공고 금액 배정 기록", () => {
  test("동시 요청 둘은 한 곳만 맡고, 자리를 회수하면 다음 후보에게, 정정공고로 자격이 빠지면 걸친 자리에게 넘긴다", async () => {
    await withAccountDatabase(async ({ owner, api }) => {
      await owner.unsafe(seed);
      const odd = await workspace(api, "오뚜기축산");
      const dongwon = await workspace(api, "동원축산");
      const oddSeat = await seat(api, odd, MEAT, "2026-11-01T15:00:00Z");
      const dongwonSeat = await seat(api, dongwon, FISH, "2026-11-02T15:00:00Z");

      const clock = new MovableClock(Temporal.Instant.from("2026-11-05T01:00:00Z"));
      const store = new DrizzleSeatAssignmentStore(drizzle({ client: api }) as unknown as SeatAssignmentDatabase);
      const assign = (auctionAttemptId: bigint) => Effect.runPromise(new AssignAuctionAmount(store, clock).execute({ auctionAttemptId }));

      // 두 품목 공고에 두 자리가 걸쳤다. 동시에 물어도 둘 다 우선권이 이른 오뚜기를 답하고 줄은 하나다.
      const answers = await Promise.all([assign(BOTH), assign(BOTH), assign(BOTH)]);
      for (const answer of answers) expect(answer).toEqual({ kind: "assigned", workspaceId: odd, marketSeatId: oddSeat });
      expect(await api.unsafe(`select count(*)::int as count from app.auction_amount_assignment where auction_attempt_id = ${BOTH}`))
        .toEqual([{ count: 1 }]);

      // 오뚜기 자리를 회수하면(끝을 자름) 다음 요청이 동원에게 넘긴다. 이전 줄은 닫혀 남는다.
      await api.unsafe(`update app.market_seat set ends_at = '2026-11-05T02:00:00Z' where market_seat_id = ${oddSeat}`);
      clock.set("2026-11-05T03:00:00Z");
      expect(await assign(BOTH)).toEqual({ kind: "assigned", workspaceId: dongwon, marketSeatId: dongwonSeat });
      expect((await api.unsafe(`
        select kind, superseded_at is not null as closed, candidate_market_seat_ids::text as candidates
          from app.auction_amount_assignment where auction_attempt_id = ${BOTH} order by auction_amount_assignment_id
      `)).map((row) => ({ ...row }))).toEqual([
        { kind: "took", closed: true, candidates: `{${oddSeat},${dongwonSeat}}` },
        { kind: "handed_over", closed: false, candidates: `{${dongwonSeat}}` },
      ]);

      // 축산 공고는 오뚜기가 없으니 아무도 맡지 않는다. 오뚜기 자리를 새로 열어 맡긴 뒤, 정정공고가 품목을 수산으로 바꾸면 동원에게 간다.
      expect(await assign(CORRECTED)).toEqual({ kind: "unassigned", reason: "no-seat" });
      const reopened = await seat(api, odd, MEAT, "2026-11-05T02:30:00Z");
      expect(await assign(CORRECTED)).toEqual({ kind: "assigned", workspaceId: odd, marketSeatId: reopened });
      await owner.unsafe(`
        ${observation(2n, "2026-11-05T03:30:00Z")}
        ${revision(9203n, CORRECTED, 2n, 9303n, "2026-11-10T02:00:00Z")}
        ${links(9203n, [FISH])}
      `);
      clock.set("2026-11-05T04:00:00Z");
      expect(await assign(CORRECTED)).toEqual({ kind: "assigned", workspaceId: dongwon, marketSeatId: dongwonSeat });
      expect(await api.unsafe(`
        select basis_observation_id::int as basis from app.auction_amount_assignment
         where auction_attempt_id = ${CORRECTED} and superseded_at is null
      `)).toEqual([{ basis: 2 }]);

      // 없는 공고는 맡을 것이 없다.
      expect(await assign(9200000000000999n)).toEqual({ kind: "unassigned", reason: "not-found" });
    });
  }, 120_000);

  test("품목 제한이 없는 공고는 품목 제한 없음 자리가 맡고, 품목 칸을 모르는 공고는 아무도 맡지 않는다", async () => {
    await withAccountDatabase(async ({ owner, api }) => {
      await owner.unsafe(seed);
      // "품목 제한 없음"은 eaT `MN_TRMT_LMT_YN`의 `N`이다. 저장소가 실제 이름공간으로 찾으므로 그 이름 그대로 둔다(ADR 0072).
      // 이 fixture는 시드를 돌리지 않을 수 있어 체계가 없으면 만든다.
      await owner.unsafe(`
        insert into core.code_scheme (namespace, owner, version_policy, valid_time_policy)
        values ('eat:main-item-restriction', 'aT', 'source-managed', 'effective-dated')
        on conflict (namespace) do nothing
      `);
      const [restriction] = await owner.unsafe(`
        insert into core.code_value (code_scheme_id, code)
        select code_scheme_id, code from core.code_scheme, (values ('N'), ('Y')) as codes(code)
         where namespace = 'eat:main-item-restriction'
        returning code, code_value_id::text as id
      `).then((rows) => [Object.fromEntries(rows.map((row) => [String(row.code), BigInt(String(row.id))]))]);
      const unrestricted = restriction!.N!;
      const restricted = restriction!.Y!;
      const OPEN = 9200000000000103n;
      const FLAGGED_ONLY = 9200000000000104n;
      await owner.unsafe(`
        insert into core.auction_attempt (auction_attempt_id, source_system, external_bid_id)
        overriding system value values (${OPEN}, 'eat', 'external-open'), (${FLAGGED_ONLY}, 'eat', 'external-flagged');
        ${revision(9204n, OPEN, 1n, 9304n, "2026-11-10T02:00:00Z")}
        insert into core.auction_revision_code_value (auction_revision_id, code_value_id, role)
        values (9204, ${GIMHAE}, 'eligibility_area'), (9204, ${unrestricted}, 'main_item_restriction');
        ${revision(9205n, FLAGGED_ONLY, 1n, 9305n, "2026-11-10T02:00:00Z")}
        insert into core.auction_revision_code_value (auction_revision_id, code_value_id, role)
        values (9205, ${GIMHAE}, 'eligibility_area'), (9205, ${restricted}, 'main_item_restriction');
      `);
      const odd = await workspace(api, "오뚜기축산");
      const dongwon = await workspace(api, "동원축산");
      // 우선권이 더 이른 축산 자리가 있어도 품목 제한 없음 공고에는 걸치지 않는다.
      await seat(api, dongwon, MEAT, "2026-11-01T15:00:00Z");
      const openSeat = await seat(api, odd, unrestricted, "2026-11-02T15:00:00Z");
      // `Y` 코드로 자리를 만들어도 품목 칸이 되지 않는다 — `Y`인 공고는 품목 원자 자리가 받는다.
      await seat(api, dongwon, restricted, "2026-11-01T15:00:00Z");

      const clock = new MovableClock(Temporal.Instant.from("2026-11-05T01:00:00Z"));
      const store = new DrizzleSeatAssignmentStore(drizzle({ client: api }) as unknown as SeatAssignmentDatabase);
      const assign = (auctionAttemptId: bigint) => Effect.runPromise(new AssignAuctionAmount(store, clock).execute({ auctionAttemptId }));

      expect(await assign(OPEN)).toEqual({ kind: "assigned", workspaceId: odd, marketSeatId: openSeat });
      expect(await api.unsafe(`
        select rule_version, candidate_market_seat_ids::text as candidates from app.auction_amount_assignment
         where auction_attempt_id = ${OPEN} and superseded_at is null
      `)).toEqual([{ rule_version: "seat-r2", candidates: `{${openSeat}}` }]);
      // 품목 원자도 `N`도 없으면 품목 칸을 모른다. 지역만으로 넓히지 않는다(ADR 0071 기각안).
      expect(await assign(FLAGGED_ONLY)).toEqual({ kind: "unassigned", reason: "no-item" });
      // 기존 품목 공고는 그대로 품목 원자로 걸친다.
      expect(await assign(CORRECTED)).toEqual({ kind: "assigned", workspaceId: dongwon, marketSeatId: expect.any(BigInt) });
    });
  }, 120_000);
});
