/**
 * @module 책임: 기관 회차 이력 조회 도중의 mart 원자적 발행(build 501→502)을 재현할 두 번째 build seed와
 * 그 전환·회수 절차, 조회 사이에 발행을 끼워 넣는 결정론적 database 어댑터를 소유한다.
 *
 * 실제 경합은 시각에 달려 있어 그대로 두면 재현되지 않는다. 순서를 여기서 한 번만 고정한다.
 */
import type { SQL } from "drizzle-orm";
import type postgres from "postgres";
import type { AuctionReadDatabase } from "../src/modules/procurement/infrastructure/drizzle/drizzle-auction-reader";

type Client = ReturnType<typeof postgres>;

/** `organization-attempts.fixture`가 활성화하는 build다. 이 fixture의 모든 대조 기준이 된다. */
export const ACTIVE_BUILD_ID = 501n;
/** 조회 도중 활성화될 다음 build다. 같은 기관의 회차 집합·표본 수·계보가 전부 다르다. */
export const NEXT_BUILD_ID = 502n;

// 회차 102는 두 build에 모두 있지만 명단 수가 다르다. 행이 어느 build에서 왔는지 이 값 하나로 갈린다.
export const ACTIVE_LIST_COUNT = 5;
export const NEXT_LIST_COUNT = 999;

// 행은 build가 `building`일 때만 쓸 수 있고 활성·봉인된 build의 행은 trigger가 거부한다(ADR 0034).
// 그래서 다음 build의 적재는 501 활성화 전에 끝내고 상태만 `verified`로 올려 둔다.
const nextBuildSeed = `
  insert into ingest.source_release (source_release_id, source, release_name, status, as_of)
  values ('00000000-0000-0000-0000-000000000142', 'eat', 'eat-2026-09-08', 'planned',
    '2026-09-08T00:00:00Z');
  insert into mart.build
    (build_id, mart_name, source_release_id, calc_version, builder_version, region_scheme,
     status, as_of, started_at)
  overriding system value
  values (502, 'org_round_summary', '00000000-0000-0000-0000-000000000142', 'mart-r2',
    '${"b".repeat(40)}', 'eat:auction-location-sido', 'building',
    '2026-09-08T00:00:00Z', '2026-09-08T00:05:00Z');
  insert into mart.org_round_summary
    (build_id, auction_attempt_id, auction_revision_id, organization_id,
     item_label, announced_at, opened_at, floor_rate, award_method_code_value_id,
     base_amount, planned_amount, currency, awarded_assessment_rate, runner_up_assessment_rate,
     day_floor_amount, day_floor_bid_rate, awarded_bid_rate, list_count, below_day_floor_count,
     withdrawn_count, withdrawal_cohort_age_days, winner_supplier_party_id, supersedes_attempt_id,
     lineage_status, opened_month_kst)
  values
    (502, 102, 208, 41, '농산', '2026-09-02T00:00:00Z', '2026-09-04T05:00:00Z',
     90.000, null, 1000000.00, 990000.00, 'KRW', 91.500, 90.412,
     891000.00, 89.1000, 90.5940, ${NEXT_LIST_COUNT}, 3, 0, 4, 77, null, 'observed', '2026-09-01'),
    (502, 101, 211, 41, null, '2026-09-01T00:00:00Z', '2026-09-03T05:00:00Z',
     null, null, 500000.00, null, 'KRW', 91.000, null, null, null, null,
     null, null, null, null, null, null, 'unknown', '2026-09-01');
  insert into mart.org_round_summary_item (build_id, auction_attempt_id, item_code_value_id)
  values (502, 102, 9);
  insert into mart.build_coverage
    (build_id, region_code_value_id, month_kst, expected_count, observed_count,
     normalized_count, quarantined_count, coverage)
  values (502, null, '2026-09-01', 2, 2, 2, 0, 'complete');
  update mart.build
     set status = 'verified', computed_at = '2026-09-08T00:10:00Z', row_count = 2
   where build_id = 502;
`;

/** `withSeededDatabase`의 `beforeActivation`으로 넘긴다. */
export async function seedNextBuild(client: Client): Promise<void> {
  await client.unsafe(nextBuildSeed);
}

/**
 * 이전 active를 `superseded`로, `verified`를 `active`로 바꾸는 한 트랜잭션이다. 이것이 ADR 0034가
 * 정한 발행 그 자체이며, 두 UPDATE 사이에 활성 build가 없는 순간을 다른 세션에 보이지 않게 한다.
 */
export async function publishNextBuild(client: Client): Promise<void> {
  await client.begin(async (transaction) => {
    await transaction.unsafe(`
      update mart.build
         set status = 'superseded', superseded_at = '2026-09-08T00:11:00Z'
       where build_id = ${ACTIVE_BUILD_ID};
    `);
    await transaction.unsafe(`
      update mart.build
         set status = 'active', activated_at = '2026-09-08T00:11:00Z'
       where build_id = ${NEXT_BUILD_ID};
    `);
  });
}

/** 활성 build를 하나도 남기지 않는다. 파생물이 아직/이미 없는 상태는 오류가 아니다. */
export async function supersedeAllBuilds(client: Client): Promise<void> {
  await client.unsafe(`
    update mart.build
       set status = 'superseded', superseded_at = '2026-09-08T00:12:00Z'
     where mart_name = 'org_round_summary' and status = 'active';
  `);
}

/**
 * 첫 조회가 끝난 직후에 발행을 끼워 넣고, 이후의 모든 조회를 발행이 끝난 뒤로 미룬다.
 *
 * 어느 조회가 첫 번째인지는 어댑터의 호출 순서가 정하므로 SQL 문자열을 들여다보지 않는다.
 * 응답 하나가 build를 한 번만 고른다면 나머지 조회는 그 결정을 그대로 따라야 하고, 조회마다 다시
 * 고른다면 이 지점에서 갈라진다.
 */
export function databaseWithPublishAfterFirstQuery(
  base: AuctionReadDatabase,
  publish: () => Promise<void>,
): AuctionReadDatabase {
  let first = true;
  let release!: () => void;
  const published = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    async execute(query: SQL): Promise<unknown> {
      if (first) {
        first = false;
        const result = await base.execute(query);
        await publish();
        release();
        return result;
      }
      await published;
      return base.execute(query);
    },
  };
}
