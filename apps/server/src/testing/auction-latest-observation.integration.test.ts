// docker PostgreSQL이 필요한 통합 테스트이며 `organization-attempts.fixture.ts`의 seed 위에 스냅샷 build 502를 더한다.
// 공고 조회가 "최신 관측 반영 안 됨"을 ingest가 아니라 활성 스냅샷 build의 mart 행에서만 읽고, 지금 보여 주는 revision과
// build가 본 revision이 같을 때만 싣는지를 실제 질의로 닫는다(ADR 0061 결정 5, EAT-295).
import { expect, test } from "bun:test";
import { Temporal } from "@eatbid/domain";
import { drizzle } from "drizzle-orm/postgres-js";
import { withSeededDatabase } from "../../fixtures/organization-attempts.fixture";
import { auctionId } from "../modules/procurement/domain/auction-id";
import { DrizzleAuctionReader } from "../modules/procurement/infrastructure/drizzle/drizzle-auction-reader";

test("활성 스냅샷 build가 미반영으로 적은 공고만 두 관측 시각을 싣고 revision이 바뀐 행은 무시한다", async () => {
  await withSeededDatabase(async ({ client }) => {
    const reader = new DrizzleAuctionReader(drizzle({ client }));

    const stale = await reader.findById(auctionId(103n));
    expect(stale?.latestObservation).toEqual({
      state: "not-reflected",
      excludedObservedAt: Temporal.Instant.from("2026-09-03T06:00:00Z"),
      reflectedObservedAt: Temporal.Instant.from("2026-09-03T00:00:30Z"),
    });
    // 102의 행은 build가 본 revision(211)이 지금 보여 주는 revision(208)과 달라 표시하지 않는다.
    expect((await reader.findById(auctionId(102n)))?.latestObservation).toEqual({ state: "reflected" });
    expect((await reader.findById(auctionId(101n)))?.latestObservation).toEqual({ state: "reflected" });
  }, async (client) => {
    // 미반영 판정은 열린 공고 스냅샷의 활성 build에서 읽는다(ADR 0060 결정 3). 회차 요약 build 501에 같은 행이
    // 있어도 읽지 않는다는 것을 함께 확인하려고 101에는 501에만 행을 둔다.
    await client.unsafe(`
  insert into mart.build
    (build_id, mart_name, source_release_id, calc_version, builder_version, region_scheme,
     status, as_of, started_at)
  overriding system value
  values (502, 'open_auction_snapshot', '00000000-0000-0000-0000-000000000141', 'mart-r1',
    '${"a".repeat(40)}', 'eat:auction-location-sigungu', 'building',
    '2026-09-04T00:00:00Z', '2026-09-04T00:05:00Z');
  insert into mart.build_stale_auction
    (build_id, auction_attempt_id, auction_revision_id, excluded_observed_at, reflected_observed_at)
  values (502, 103, 207, '2026-09-03T06:00:00Z', '2026-09-03T00:00:30Z'),
         (502, 102, 211, '2026-09-03T06:00:00Z', '2026-09-03T00:00:30Z'),
         (501, 101, 211, '2026-09-03T06:00:00Z', '2026-09-03T00:00:30Z');
  update mart.build set status = 'verified', computed_at = '2026-09-04T00:10:00Z', row_count = 0
   where build_id = 502;
  update mart.build set status = 'active', activated_at = '2026-09-04T00:11:00Z'
   where build_id = 502;
`);
  });
}, 180_000);
