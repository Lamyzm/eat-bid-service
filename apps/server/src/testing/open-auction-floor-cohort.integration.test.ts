// docker PostgreSQL이 필요한 통합 검사이며 `open-auctions.integration.test.ts`와 같은 공용 harness·관행을 따른다.
import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import { Temporal } from "@eatbid/domain";
import type {
  OpenAuctionListing,
  OpenAuctionOrgSummaryRecord,
  OpenAuctionPage,
  OpenAuctionQuery,
} from "../modules/procurement/application/open-auction-reader";
import { DrizzleOpenAuctionReader } from "../modules/procurement/infrastructure/drizzle/drizzle-open-auction-reader";
import { disposableDatabase } from "../../fixtures/disposable-database.fixture";

/**
 * 2026-09-09 운영 복원본(build 213)에서 읽은 두 사례를 그대로 고정한다.
 *
 * 진해남중학교(기관 1683)는 하한율 88.000과 90.000 두 코호트를 함께 갖는데, 둘의 마지막 개찰 회차가
 * 같은 시각에 개찰돼 기관 단위로 고르면 식별자가 큰 90.000 회차(6865)가 두 열린 행을 모두 덮었다.
 * 화면에 88.000 행과 90.000 행이 나란히 `89.5400 / 06-11 09:00 · 명단 68 · 하한 아래 19`로 찍힌 것이
 * 이 결함이다. 마산중앙초등학교(기관 1903)는 반대 방향의 대조군이다. 하한율이 90.000 하나이고 품목만
 * 미확인·수산물·육류 셋으로 갈리므로 세 행이 같은 요약을 쓰는 것이 옳다 — 품목으로 좁히지 않는다.
 *
 * 기관·회차 식별자, 하한율, 품목 라벨, 개찰 시각, 낙찰 투찰률, 명단 수는 복원본 값 그대로다. 코호트당
 * 회차는 grain을 읽는 데 필요한 하나만 남겼고(복원본은 5·5·19회차), 금액은 비율 열이 맞아떨어지도록 골랐다.
 */
const NOW = Temporal.Instant.from("2026-09-10T12:00:00Z");

const sha = (label: string): string => label.padEnd(64, "0");

const seed = `
  insert into core.organization (organization_id, type, canonical_name)
  overriding system value
  values (1683, 'school', null), (1903, 'school', null);
  insert into core.auction_attempt (auction_attempt_id, source_system, external_bid_id)
  overriding system value
  values (6848, 'eat', 'external-6848'), (6865, 'eat', 'external-6865'),
         (7593, 'eat', 'external-7593'), (38599, 'eat', 'external-38599'),
         (38600, 'eat', 'external-38600'), (10486, 'eat', 'external-10486'),
         (10495, 'eat', 'external-10495'), (10505, 'eat', 'external-10505');
  insert into ingest.run
    (run_id, mode, status, build_sha, parser_version, started_at, ended_at,
     failure_category, expected_count, captured_count, published_count)
  values
    ('00000000-0000-0000-0000-000000000166', 'capture', 'published', '${sha("f166")}',
     'eat-v2', '2026-09-10T00:00:00Z', '2026-09-10T00:01:00Z', null, 1, 1, 1);
  insert into ingest.request_unit
    (request_unit_id, run_id, source, endpoint, request_params, request_params_hash,
     expected_count, observed_count, status)
  overriding system value
  values
    (3160, '00000000-0000-0000-0000-000000000166', 'eat', 'bid-list', '{}',
     '${sha("e166")}', 1, 1, 'captured');
  insert into ingest.raw_blob
    (content_sha256, object_key, byte_length, content_type, content_encoding, stored_at)
  values ('${sha("d166")}', 'raw/eat/bid-list/${sha("d166")}.xml.gz', 10,
    'application/xml', 'gzip', '2026-09-10T00:00:30Z');
  insert into ingest.raw_observation
    (observation_id, run_id, request_unit_id, source, endpoint, request_params,
     fetched_at, http_status, content_sha256)
  overriding system value
  values
    (3161, '00000000-0000-0000-0000-000000000166', 3160, 'eat', 'bid-list', '{}',
     '2026-09-10T00:30:00Z', 200, '${sha("d166")}');
  insert into ingest.normalized_record
    (normalized_record_id, observation_id, record_type, source_entity_id, normalized_payload,
     parser_version, normalized_at)
  overriding system value
  values (4161, 3161, 'auction.v2', 'external-6848', '{}', 'eat-v2', '2026-09-10T00:00:40Z'),
         (4162, 3161, 'auction.v2', 'external-6865', '{}', 'eat-v2', '2026-09-10T00:00:40Z'),
         (4163, 3161, 'auction.v2', 'external-7593', '{}', 'eat-v2', '2026-09-10T00:00:40Z'),
         (4164, 3161, 'auction.v2', 'external-38599', '{}', 'eat-v2', '2026-09-10T00:00:40Z'),
         (4165, 3161, 'auction.v2', 'external-38600', '{}', 'eat-v2', '2026-09-10T00:00:40Z'),
         (4166, 3161, 'auction.v2', 'external-10486', '{}', 'eat-v2', '2026-09-10T00:00:40Z'),
         (4167, 3161, 'auction.v2', 'external-10495', '{}', 'eat-v2', '2026-09-10T00:00:40Z'),
         (4168, 3161, 'auction.v2', 'external-10505', '{}', 'eat-v2', '2026-09-10T00:00:40Z');
  insert into core.auction_revision
    (auction_revision_id, auction_attempt_id, normalized_record_id, observation_id,
     content_sha256, display_bid_no, source_status, title, announced_at, deadline_at,
     opened_at, base_amount, planned_amount, currency, source_payload)
  overriding system value
  values (5161, 6848, 4161, 3161, '${sha("a1")}', null, 'OPEN', '급식 식재료 구매',
    '2026-06-04T00:00:00Z', null, '2026-06-11T00:00:00Z', 10000000.00, 9965400.00, 'KRW', '{}'),
         (5162, 6865, 4162, 3161, '${sha("a2")}', null, 'OPEN', '육류 , 가금류 구매',
    '2026-06-04T00:00:00Z', null, '2026-06-11T00:00:00Z', 9000000.00, 8954000.00, 'KRW', '{}'),
         (5163, 7593, 4163, 3161, '${sha("a3")}', null, 'OPEN', '육류 구매',
    '2026-06-11T00:00:00Z', null, '2026-06-18T01:00:00Z', 5000000.00, 4941845.00, 'KRW', '{}'),
         (5164, 38599, 4164, 3161, '${sha("a4")}', null, 'OPEN', '급식 식재료 구매',
    '2026-09-08T00:00:00Z', '2026-09-10T23:00:00Z', null, 3000000.00, null, 'KRW', '{}'),
         (5165, 38600, 4165, 3161, '${sha("a5")}', null, 'OPEN', '육류 , 가금류 구매',
    '2026-09-08T00:00:00Z', '2026-09-10T23:00:00Z', null, 3000000.00, null, 'KRW', '{}'),
         (5166, 10486, 4166, 3161, '${sha("a6")}', null, 'OPEN', '급식 식재료 구매',
    '2026-09-08T00:00:00Z', '2026-09-11T00:00:00Z', null, 3000000.00, null, 'KRW', '{}'),
         (5167, 10495, 4167, 3161, '${sha("a7")}', null, 'OPEN', '수산물 구매',
    '2026-09-08T00:00:00Z', '2026-09-11T00:00:00Z', null, 3000000.00, null, 'KRW', '{}'),
         (5168, 10505, 4168, 3161, '${sha("a8")}', null, 'OPEN', '육류 구매',
    '2026-09-08T00:00:00Z', '2026-09-11T00:00:00Z', null, 3000000.00, null, 'KRW', '{}');
  insert into ingest.source_release (source_release_id, source, release_name, status, as_of)
  values ('00000000-0000-0000-0000-000000000166', 'eat', 'eat-2026-09-10', 'planned',
    '2026-09-10T00:00:00Z');
  insert into mart.build
    (build_id, mart_name, source_release_id, calc_version, builder_version, region_scheme,
     status, as_of, started_at)
  overriding system value
  values (5010, 'org_round_summary', '00000000-0000-0000-0000-000000000166', 'mart-r3',
    '${"a".repeat(40)}', null, 'building', '2026-09-10T00:00:00Z', '2026-09-10T00:05:00Z'),
         (6010, 'open_auction_snapshot', '00000000-0000-0000-0000-000000000166', 'mart-r3',
    '${"a".repeat(40)}', null, 'building', '2026-09-10T00:00:00Z', '2026-09-10T00:05:00Z');
  insert into mart.org_round_summary
    (build_id, auction_attempt_id, auction_revision_id, organization_id,
     item_label, announced_at, opened_at, floor_rate, award_method_code_value_id,
     base_amount, planned_amount, currency, awarded_assessment_rate, runner_up_assessment_rate,
     day_floor_amount, day_floor_bid_rate, awarded_bid_rate, list_count, below_day_floor_count,
     withdrawn_count, withdrawal_cohort_age_days, winner_supplier_party_id, supersedes_attempt_id,
     lineage_status, opened_month_kst)
  values
    (5010, 6848, 5161, 1683, null, '2026-06-04T00:00:00Z', '2026-06-11T00:00:00Z',
     88.000, null, 10000000.00, 9965400.00, 'KRW', 88.019, 88.061,
     8769552.00, 87.6955, 87.7144, 82, 20, null, null, null, null, 'observed', '2026-06-01'),
    (5010, 6865, 5162, 1683, '육류 , 가금류', '2026-06-04T00:00:00Z', '2026-06-11T00:00:00Z',
     90.000, null, 9000000.00, 8954000.00, 'KRW', 90.000, 90.043,
     8058600.00, 89.5400, 89.5400, 68, 19, null, null, null, null, 'observed', '2026-06-01'),
    (5010, 7593, 5163, 1903, '육류', '2026-06-11T00:00:00Z', '2026-06-18T01:00:00Z',
     90.000, null, 5000000.00, 4941845.00, 'KRW', 90.085, 90.132,
     4447660.50, 88.9532, 89.0372, 30, 5, null, null, null, null, 'observed', '2026-06-01');
  insert into mart.open_auction_snapshot
    (build_id, auction_attempt_id, observed_at, observation_id, organization_id, bid_count,
     source_last_changed_at, closes_at, base_amount, currency, item_label, floor_rate,
     region_sido_code_value_id, region_sigungu_code_value_id, organization_label, terms_revision_id)
  values
    (6010, 38599, '2026-09-10T00:30:00Z', 3161, 1683, 4, null, '2026-09-10T23:00:00Z',
     3000000.00, 'KRW', null, 88.000, null, null, '진해남중학교', 5164),
    (6010, 38600, '2026-09-10T00:30:00Z', 3161, 1683, 6, null, '2026-09-10T23:00:00Z',
     3000000.00, 'KRW', '육류 , 가금류', 90.000, null, null, '진해남중학교', 5165),
    (6010, 10486, '2026-09-10T00:30:00Z', 3161, 1903, 2, null, '2026-09-11T00:00:00Z',
     3000000.00, 'KRW', null, 90.000, null, null, '마산중앙초등학교', 5166),
    (6010, 10495, '2026-09-10T00:30:00Z', 3161, 1903, 3, null, '2026-09-11T00:00:00Z',
     3000000.00, 'KRW', '수산물', 90.000, null, null, '마산중앙초등학교', 5167),
    (6010, 10505, '2026-09-10T00:30:00Z', 3161, 1903, 5, null, '2026-09-11T00:00:00Z',
     3000000.00, 'KRW', '육류', 90.000, null, null, '마산중앙초등학교', 5168);
  insert into mart.build_coverage
    (build_id, region_code_value_id, month_kst, expected_count, observed_count,
     normalized_count, quarantined_count, coverage)
  values (5010, null, '2026-09-01', 3, 3, 3, 0, 'unknown'),
         (6010, null, '2026-09-01', 5, 5, 5, 0, 'partial');
  update mart.build set status = 'verified', computed_at = '2026-09-10T00:10:00Z', row_count = 3 where build_id = 5010;
  update mart.build set status = 'active', activated_at = '2026-09-10T00:11:00Z' where build_id = 5010;
  update mart.build set status = 'verified', computed_at = '2026-09-10T00:10:00Z', row_count = 5 where build_id = 6010;
  update mart.build set status = 'active', activated_at = '2026-09-10T00:11:00Z' where build_id = 6010;
`;

const { withDatabase, expectOwnedContainersCleanedUp } = disposableDatabase({
  task: "eat166-floor-cohort",
  migrationApplyCount: 1,
  seed: async (owner) => { await owner.unsafe(seed); },
});

function pageOf(listing: OpenAuctionListing): OpenAuctionPage {
  if (listing.kind !== "page") throw new Error(`expected a page but got ${listing.kind}`);
  return listing.page;
}

const baseQuery: OpenAuctionQuery = {
  asOf: NOW,
  sidoCodeValueId: null,
  sigunguCodeValueIds: null,
  includeUnknownRegion: false,
  eligibilityAreaCodeValueIds: null,
  itemAtoms: null,
  includeUnknownItem: false,
  searchText: null,
  onlyWithoutBids: false,
  closesWithinHours: null,
  closesOnKst: null,
  announcedOnKst: null,
  baseAmountMin: null,
  baseAmountMax: null,
  cursor: null,
  limit: 50,
};

describe("열린 공고 기관 요약의 하한율 코호트 PostgreSQL 경계", () => {
  test("하한율이 둘인 기관은 행마다 같은 하한율의 회차만 요약하고 품목이 갈려도 좁히지 않는다", async () => {
    await withDatabase(async ({ api }) => {
      const reader = new DrizzleOpenAuctionReader(drizzle({ client: api }));
      const page = pageOf(await reader.listOpen(baseQuery));
      const summaryOf = (attemptId: bigint): OpenAuctionOrgSummaryRecord | null => {
        const auction = page.auctions.find((row) => row.auctionAttemptId === attemptId);
        if (auction === undefined) throw new Error(`open auction ${attemptId} is missing from the page`);
        return auction.orgSummary;
      };

      expect(page.auctions.map((row) => row.auctionAttemptId))
        .toEqual([38_599n, 38_600n, 10_486n, 10_495n, 10_505n]);
      expect(page.auctions.map((row) => row.floorRate))
        .toEqual(["88.000", "90.000", "90.000", "90.000", "90.000"]);

      // 진해남중학교: 하한율 88.000 행은 88.000 회차만, 90.000 행은 90.000 회차만 요약한다.
      const floor88 = summaryOf(38_599n);
      const floor90 = summaryOf(38_600n);
      expect(floor88).toMatchObject({
        attemptCount: 1,
        medianListCount: 82,
        listCountSampleCount: 1,
        lastRound: {
          auctionAttemptId: 6_848n,
          awardedBidRate: "87.7144",
          dayFloorBidRate: "87.6955",
          listCount: 82,
          belowDayFloorCount: 20,
        },
      });
      expect(floor90).toMatchObject({
        attemptCount: 1,
        medianListCount: 68,
        listCountSampleCount: 1,
        lastRound: {
          auctionAttemptId: 6_865n,
          awardedBidRate: "89.5400",
          dayFloorBidRate: "89.5400",
          listCount: 68,
          belowDayFloorCount: 19,
        },
      });
      // 두 회차는 개찰 시각이 같다. 기관 단위로 고르면 식별자가 큰 6865가 두 행을 모두 덮었다.
      expect(floor88!.lastRound!.openedAt.toString()).toBe("2026-06-11T00:00:00Z");
      expect(floor90!.lastRound!.openedAt.toString()).toBe("2026-06-11T00:00:00Z");
      expect(floor88!.lastRound!.auctionAttemptId).not.toBe(floor90!.lastRound!.auctionAttemptId);
      expect(floor88!.medianListCount).not.toBe(floor90!.medianListCount);

      // 마산중앙초등학교: 하한율이 하나이므로 품목이 미확인·수산물·육류로 갈려도 같은 요약을 쓴다.
      for (const attemptId of [10_486n, 10_495n, 10_505n]) {
        expect(summaryOf(attemptId)).toMatchObject({
          attemptCount: 1,
          medianListCount: 30,
          listCountSampleCount: 1,
          lastRound: {
            auctionAttemptId: 7_593n,
            awardedBidRate: "89.0372",
            dayFloorBidRate: "88.9532",
            listCount: 30,
            belowDayFloorCount: 5,
          },
        });
      }
      expect(summaryOf(10_486n)!.lastRound!.openedAt.toString()).toBe("2026-06-18T01:00:00Z");
    });
    await expectOwnedContainersCleanedUp();
  }, 180_000);
});
