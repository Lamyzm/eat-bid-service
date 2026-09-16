// docker PostgreSQL이 필요한 통합 테스트이며 `auction-roster.integration.test.ts`와 같은 공용 harness·관행을 따른다.
import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import request from "supertest";
import { auctionV1Operations } from "@eatbid/contracts";
import { fixedClock, Temporal } from "@eatbid/domain";
import { createApp } from "../bootstrap/create-app";
import { parseEnvironment } from "../platform/config/environment";
import type {
  OpenAuctionListing,
  OpenAuctionPage,
  OpenAuctionQuery,
} from "../modules/procurement/application/open-auction-reader";
import type { OpenAuctionSummaryQuery } from "../modules/procurement/application/open-auction-summary-reader";
import { auctionId } from "../modules/procurement/domain/auction-id";
import { DrizzleAuctionReader } from "../modules/procurement/infrastructure/drizzle/drizzle-auction-reader";
import { DrizzleOpenAuctionReader } from "../modules/procurement/infrastructure/drizzle/drizzle-open-auction-reader";
import { DrizzleOpenAuctionSummaryReader } from "../modules/procurement/infrastructure/drizzle/drizzle-open-auction-summary-reader";
import { disposableDatabase } from "../../fixtures/disposable-database.fixture";
import { signedInSessionAuthenticator } from "../../fixtures/session-authenticator.fixture";

// 시나리오: 201은 오늘 마감(관측 둘), 202는 내일 마감이고 상세가 아직 없음, 203은 기관·마감 미확인,
// 204는 이미 마감, 205는 사흘 뒤 마감이고 하한율만 88.000으로 다르다. 기관 41의 회차 요약은 전부 하한율
// 90.000이며 개찰(101·102)·개찰 미관측(103)·개찰 예정(104)으로 나뉜다.
const NOW = Temporal.Instant.from("2026-09-07T01:00:00Z");

const seed = `
  insert into core.organization (organization_id, type, canonical_name)
  overriding system value
  values (41, 'unknown', null), (43, 'school', '다른 학교');
  insert into core.code_scheme (code_scheme_id, namespace, owner, version_policy, valid_time_policy)
  overriding system value
  values (11, 'eat:auction-location-sido', 'eat', 'immutable', 'open'),
         (12, 'eat:auction-location-sigungu', 'eat', 'immutable', 'open'),
         -- 품목 원자 체계는 운영에서 시드가 심지만 이 seed의 다리표 삽입이 그보다 먼저 돌므로 여기서도 심는다.
         (13, 'eatbid:auction-item', 'eatbid', 'product-managed', 'effective-dated');
  insert into core.code_value (code_value_id, code_scheme_id, code)
  overriding system value
  values (41, 11, '48'), (43, 12, '48120'), (44, 12, '48250'),
         (51, 13, '육류'), (52, 13, '가금류'), (53, 13, '농산물'), (54, 13, '수산물'),
         (55, 13, '가공식품'), (56, 13, '김치류'), (57, 13, '곡류'), (58, 13, '우유류');
  insert into core.auction_attempt (auction_attempt_id, source_system, external_bid_id)
  overriding system value
  values (101, 'eat', 'external-101'), (102, 'eat', 'external-102'),
         (103, 'eat', 'external-103'), (104, 'eat', 'external-104'),
         (201, 'eat', 'external-201'), (202, 'eat', 'external-202'),
         (203, 'eat', 'external-203'), (204, 'eat', 'external-204'),
         (205, 'eat', 'external-205'), (206, 'eat', 'external-206');
  insert into ingest.run
    (run_id, mode, status, build_sha, parser_version, started_at, ended_at,
     failure_category, expected_count, captured_count, published_count)
  values
    ('00000000-0000-0000-0000-000000000041', 'capture', 'published', '${"a".repeat(64)}',
     'eat-v2', '2026-09-03T00:00:00Z', '2026-09-03T00:01:00Z', null, 1, 1, 1);
  insert into ingest.request_unit
    (request_unit_id, run_id, source, endpoint, request_params, request_params_hash,
     expected_count, observed_count, status)
  overriding system value
  values
    (301, '00000000-0000-0000-0000-000000000041', 'eat', 'bid-list', '{}',
     '${"b".repeat(64)}', 1, 1, 'captured');
  insert into ingest.raw_blob
    (content_sha256, object_key, byte_length, content_type, content_encoding, stored_at)
  values ('${"c".repeat(64)}', 'raw/eat/bid-list/${"c".repeat(64)}.xml.gz', 10,
    'application/xml', 'gzip', '2026-09-03T00:00:30Z');
  insert into ingest.raw_observation
    (observation_id, run_id, request_unit_id, source, endpoint, request_params,
     fetched_at, http_status, content_sha256)
  overriding system value
  values
    (303, '00000000-0000-0000-0000-000000000041', 301, 'eat', 'bid-list', '{}',
     '2026-09-07T00:00:00Z', 200, '${"c".repeat(64)}'),
    (304, '00000000-0000-0000-0000-000000000041', 301, 'eat', 'bid-list', '{}',
     '2026-09-07T00:30:00Z', 200, '${"c".repeat(64)}');
  insert into core.code_label_observation (code_value_id, label, language, observed_at, observation_id)
  values (41, '경상남도', 'ko', '2026-09-03T00:00:30Z', 303),
         (43, '창원시', 'ko', '2026-09-03T00:00:30Z', 303);
  insert into ingest.normalized_record
    (normalized_record_id, observation_id, record_type, source_entity_id, normalized_payload,
     parser_version, normalized_at)
  overriding system value
  values (405, 303, 'auction.v2', 'external-101', '{}', 'eat-v2', '2026-09-03T00:00:40Z'),
         (406, 303, 'auction.v2', 'external-102', '{}', 'eat-v2', '2026-09-03T00:00:40Z'),
         (407, 303, 'auction.v2', 'external-103', '{}', 'eat-v2', '2026-09-03T00:00:40Z'),
         (408, 303, 'auction.v2', 'external-104', '{}', 'eat-v2', '2026-09-03T00:00:40Z'),
         (409, 303, 'auction.v2', 'external-201', '{}', 'eat-v2', '2026-09-03T00:00:40Z'),
         (410, 303, 'auction.v2', 'external-205', '{}', 'eat-v2', '2026-09-03T00:00:40Z');
  insert into core.auction_revision
    (auction_revision_id, auction_attempt_id, normalized_record_id, observation_id,
     content_sha256, display_bid_no, source_status, title, announced_at, deadline_at,
     opened_at, base_amount, planned_amount, currency, source_payload)
  overriding system value
  values (505, 101, 405, 303, '${"d".repeat(64)}', null, 'OPEN', '축산물 구매',
    '2026-09-01T00:00:00Z', null, '2026-09-03T05:00:00Z', 1000000.00, 990000.00, 'KRW', '{}'),
         (506, 102, 406, 303, '${"e".repeat(64)}', null, 'OPEN', '농산물 구매',
    '2026-09-02T00:00:00Z', null, '2026-09-04T05:00:00Z', 2000000.00, null, 'KRW', '{}'),
         (507, 103, 407, 303, '${"f".repeat(64)}', null, 'OPEN', '축산물 구매',
    '2026-09-03T00:00:00Z', null, null, 500000.00, null, 'KRW', '{}'),
         (508, 104, 408, 303, '${"0".repeat(64)}', null, 'OPEN', '축산물 구매',
    '2026-09-06T00:00:00Z', null, '2026-09-09T05:00:00Z', 700000.00, null, 'KRW', '{}'),
         (509, 201, 409, 303, '${"1".repeat(64)}', null, 'OPEN', '축산물 구매',
    '2026-09-05T00:00:00Z', '2026-09-07T05:00:00Z', '2026-09-07T08:00:00Z', 2761700.00, null, 'KRW', '{}'),
         (510, 205, 410, 303, '${"2".repeat(64)}', null, 'OPEN', '축산물 구매',
    '2026-09-05T00:00:00Z', '2026-09-10T05:00:00Z', '2026-09-10T08:00:00Z', 43879200.00, null, 'KRW', '{}');
  insert into ingest.source_release (source_release_id, source, release_name, status, as_of)
  values ('00000000-0000-0000-0000-000000000141', 'eat', 'eat-2026-09-07', 'planned',
    '2026-09-07T00:00:00Z');
  insert into mart.build
    (build_id, mart_name, source_release_id, calc_version, builder_version, region_scheme,
     status, as_of, started_at)
  overriding system value
  values (501, 'org_round_summary', '00000000-0000-0000-0000-000000000141', 'mart-r1',
    '${"a".repeat(40)}', null, 'building', '2026-09-07T00:00:00Z', '2026-09-07T00:05:00Z'),
         (601, 'open_auction_snapshot', '00000000-0000-0000-0000-000000000141', 'mart-r2',
    '${"a".repeat(40)}', 'eat:auction-location-sigungu', 'building',
    '2026-09-07T00:00:00Z', '2026-09-07T00:05:00Z'),
         (602, 'open_auction_snapshot', '00000000-0000-0000-0000-000000000141', 'mart-r1',
    '${"a".repeat(40)}', 'eat:auction-location-sigungu', 'building',
    '2026-09-06T00:00:00Z', '2026-09-06T00:05:00Z');
  insert into mart.org_round_summary
    (build_id, auction_attempt_id, auction_revision_id, organization_id, item_code_value_id,
     item_label, announced_at, opened_at, floor_rate, award_method_code_value_id,
     base_amount, planned_amount, currency, awarded_assessment_rate, runner_up_assessment_rate,
     day_floor_amount, day_floor_bid_rate, awarded_bid_rate, list_count, below_day_floor_count,
     withdrawn_count, withdrawal_cohort_age_days, winner_supplier_party_id, supersedes_attempt_id,
     lineage_status, opened_month_kst)
  values
    (501, 101, 505, 41, null, '축산', '2026-09-01T00:00:00Z', '2026-09-03T05:00:00Z',
     90.000, null, 1000000.00, 990000.00, 'KRW', 90.309, 90.412,
     891000.00, 89.1000, 89.4059, 5, 0, 0, 1, null, null, 'observed', '2026-09-01'),
    (501, 102, 506, 41, null, '농산', '2026-09-02T00:00:00Z', '2026-09-04T05:00:00Z',
     90.000, null, 2000000.00, 1980000.00, 'KRW', null, null,
     1782000.00, 88.0350, null, 17, 2, null, null, null, null, 'unknown', '2026-09-01'),
    (501, 103, 507, 41, null, '축산', '2026-09-03T00:00:00Z', null,
     90.000, null, 500000.00, null, 'KRW', null, null, null, null, null,
     9, 1, null, null, null, null, 'unknown', null),
    (501, 104, 508, 41, null, '축산', '2026-09-06T00:00:00Z', '2026-09-09T05:00:00Z',
     90.000, null, 700000.00, null, 'KRW', null, null, null, null, null,
     null, null, null, null, null, null, 'unknown', '2026-09-01');
  insert into mart.open_auction_snapshot
    (build_id, auction_attempt_id, observed_at, observation_id, organization_id, bid_count,
     source_last_changed_at, closes_at, base_amount, currency, item_label, floor_rate,
     region_sido_code_value_id, region_sigungu_code_value_id, organization_label, terms_revision_id,
     source_status_label, announced_at, title, display_bid_no)
  values
    -- 게시일이 KST 09-07이라 NOW와 같은 날이다. 오늘 열린 축이 세는 단 한 건이다.
    (601, 201, '2026-09-07T00:00:00Z', 303, 41, 3, '2026-09-06T23:00:00Z', '2026-09-07T05:00:00Z',
     2761700.00, 'KRW', '육류 , 가금류', 90.000, 41, 43, '창원 남산초등학교', 509, '진행중', '2026-09-07T00:00:00Z',
     '남산초 2학기 축산물 구매', '2026-0201'),
    (601, 201, '2026-09-07T00:30:00Z', 304, 41, 5, '2026-09-07T00:10:00Z', '2026-09-07T05:00:00Z',
     2761700.00, 'KRW', '육류 , 가금류', 90.000, 41, 43, '창원 남산초등학교', 509, '진행중', '2026-09-07T00:00:00Z',
     '남산초 2학기 축산물 구매', '2026-0201'),
    -- 상태를 관측하지 못한 행은 숨기지 않는다. 이 열이 생기기 전 build의 행이 그렇다(AGENTS 3).
    -- 게시일을 관측하지 못한 두 행이다. 상세를 아직 안 딴 공고가 이렇게 남는다(AGENTS 3).
    (601, 202, '2026-09-07T00:30:00Z', 304, 43, 0, null, '2026-09-08T05:00:00Z',
     10000000.00, 'KRW', null, null, null, null, '다른 학교', null, null, null, null, null),
    (601, 203, '2026-09-07T00:30:00Z', 304, null, null, null, null,
     500000.00, 'KRW', null, null, null, null, null, null, null, null, null, null),
    (601, 204, '2026-09-07T00:30:00Z', 304, 41, 7, null, '2026-09-06T05:00:00Z',
     900000.00, 'KRW', '육류 , 가금류', 90.000, 41, 43, '창원 남산초등학교', 509, '진행중', '2026-09-07T00:00:00Z',
     '남산초 1학기 축산물 구매', '2026-0204'),
    (601, 205, '2026-09-07T00:30:00Z', 304, 41, 2, null, '2026-09-10T05:00:00Z',
     43879200.00, 'KRW', '육류 , 가금류', 88.000, 41, 44, '창원 남산초등학교', 510, '진행중', '2026-09-05T00:00:00Z',
     '남산초 2학기 축산물 구매 재공고', '2026-0205'),
    -- 마감은 안 지났지만 목록이 취소로 표시한 행이다. 마감 순으로는 202와 205 사이에 서야 하는데
    -- 열린 공고가 아니므로 목록에도 지역 미리보기 분모에도 안 들어간다(EAT-203).
    (601, 206, '2026-09-07T00:30:00Z', 304, 41, 1, null, '2026-09-09T05:00:00Z',
     3000000.00, 'KRW', '육류 , 가금류', 90.000, 41, 43, '창원 남산초등학교', 509, '공고취소', '2026-09-07T00:00:00Z',
     '남산초 2학기 축산물 구매 취소분', '2026-0206'),
    -- 물린 build의 행은 목록에 나오면 안 된다. 다만 참여 수 추이(공고 상세의 하루 전 관측)는 retain 안의
    -- 물린 build 행까지 같은 시계열로 읽는다(ADR 0034).
    (602, 202, '2026-09-06T00:30:00Z', 303, 43, 0, null, '2026-09-08T05:00:00Z',
     10000000.00, 'KRW', null, null, null, null, '다른 학교', null, null, null, null, null),
    (602, 201, '2026-09-06T00:00:00Z', 303, 41, 1, null, '2026-09-07T05:00:00Z',
     2761700.00, 'KRW', '육류 , 가금류', 90.000, 41, 43, '창원 남산초등학교', 509, '진행중', null,
     '남산초 2학기 축산물 구매', '2026-0201'),
    -- 최신 관측에서 24시간이 안 되는 관측은 "어제"가 아니다.
    (602, 201, '2026-09-06T01:00:00Z', 303, 41, 2, null, '2026-09-07T05:00:00Z',
     2761700.00, 'KRW', '육류 , 가금류', 90.000, 41, 43, '창원 남산초등학교', 509, '진행중', null,
     '남산초 2학기 축산물 구매', '2026-0201');
  insert into mart.open_auction_snapshot_item (open_auction_snapshot_id, item_code_value_id)
  select snapshot.open_auction_snapshot_id, value.code_value_id
    from mart.open_auction_snapshot snapshot
    cross join lateral unnest(string_to_array(snapshot.item_label, ',')) as part
    join core.code_value value on value.code = btrim(part)
    join core.code_scheme scheme
      on scheme.code_scheme_id = value.code_scheme_id and scheme.namespace = 'eatbid:auction-item'
   where snapshot.build_id in (601, 602);
  insert into mart.build_coverage
    (build_id, region_code_value_id, month_kst, expected_count, observed_count,
     normalized_count, quarantined_count, coverage)
  values (501, null, '2026-09-01', 10, 10, 10, 0, 'unknown'),
         (601, null, '2026-09-01', 10, 10, 10, 0, 'partial');
  update mart.build set status = 'verified', computed_at = '2026-09-07T00:10:00Z', row_count = 4 where build_id = 501;
  update mart.build set status = 'active', activated_at = '2026-09-07T00:11:00Z' where build_id = 501;
  update mart.build set status = 'verified', computed_at = '2026-09-06T00:10:00Z', row_count = 1 where build_id = 602;
  update mart.build set status = 'active', activated_at = '2026-09-06T00:11:00Z' where build_id = 602;
  update mart.build set status = 'superseded', superseded_at = '2026-09-07T00:11:00Z' where build_id = 602;
  update mart.build set status = 'verified', computed_at = '2026-09-07T00:10:00Z', row_count = 6 where build_id = 601;
  update mart.build set status = 'active', activated_at = '2026-09-07T00:11:00Z' where build_id = 601;
`;

const { withDatabase, expectOwnedContainersCleanedUp } = disposableDatabase({
  task: "eat39-open-auctions",
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

const ids = (page: OpenAuctionPage) => page.auctions.map((auction) => auction.auctionAttemptId);

describe("공고 상세 참여 수 관측 PostgreSQL 경계", () => {
  test("최신 관측과 24시간 이상 앞선 가장 늦은 관측을 물린 build까지 읽고 관측 없는 공고는 null이다", async () => {
    await withDatabase(async ({ api }) => {
      const reader = new DrizzleAuctionReader(drizzle({ client: api }));
      // 201: 활성 build의 00:30 관측(5)이 최신이고, 하루 전은 물린 build 602의 09-06 00:00 관측(1)이다.
      // 09-06 01:00 관측(2)은 최신에서 23시간 30분 앞이라 "어제"가 아니다.
      const open = await reader.findById(auctionId(201n));
      expect(open?.participation?.latest.bidCount).toBe(5);
      expect(open?.participation?.latest.observedAt.toString()).toBe("2026-09-07T00:30:00Z");
      expect(open?.participation?.dayEarlier?.bidCount).toBe(1);
      expect(open?.participation?.dayEarlier?.observedAt.toString()).toBe("2026-09-06T00:00:00Z");
      // 205: 관측 하나뿐이라 하루 전이 없다.
      const single = await reader.findById(auctionId(205n));
      expect(single?.participation?.latest.bidCount).toBe(2);
      expect(single?.participation?.dayEarlier).toBeNull();
      // 101: 목록 스냅샷에 잡힌 적 없는 개찰된 회차는 블록째 null이다.
      expect((await reader.findById(auctionId(101n)))?.participation).toBeNull();
    });
    await expectOwnedContainersCleanedUp();
  }, 180_000);
});

describe("mart 열린 공고 목록 PostgreSQL 경계", () => {
  test("마감 임박 정렬·최신 관측 선택·필터·keyset 페이지·기관 요약이 실제 mart 행에서 맞는다", async () => {
    await withDatabase(async ({ api, apiUrl }) => {
      const reader = new DrizzleOpenAuctionReader(drizzle({ client: api }));

      // 마감 임박 순이며 마감 미확인(203)은 맨 뒤, 이미 마감된 204와 물린 build의 행은 없다.
      // 취소된 206은 마감이 09-09라 202와 205 사이에 서야 하는데 열린 공고가 아니므로 빠진다(EAT-203).
      const all = pageOf(await reader.listOpen(baseQuery));
      expect(ids(all)).toEqual([201n, 202n, 205n, 203n]);
      expect(all.sampleCount).toBe(4);
      expect(all.nextCursor).toBeNull();
      // 한 build 안 같은 공고의 관측이 여럿이면 가장 최근 관측 하나만 목록에 낸다.
      expect(all.auctions[0]).toMatchObject({
        bidCount: 5,
        floorRate: "90.000",
        itemLabel: "육류 , 가금류",
        displayBidNo: "2026-0201",
        termsRevisionId: 509n,
        organization: { organizationId: 41n, label: "창원 남산초등학교", type: "unknown" },
        region: {
          sido: { codeValueId: 41n, code: "48", scheme: "eat:auction-location-sido", label: "경상남도" },
          sigungu: { codeValueId: 43n, code: "48120", scheme: "eat:auction-location-sigungu", label: "창원시" },
        },
      });
      expect(all.auctions[0]!.observedAt.toString()).toBe("2026-09-07T00:30:00Z");
      // 기관 41 · 하한율 90.000 코호트는 **기준 시각까지 개찰된 회차만** 센다. 네 회차 중 103은 개찰
      // 시각이 미관측이고 104는 09-09라 NOW(09-07 10시 KST) 뒤다. 남는 것은 101·102 둘이고 명단 표본은
      // [5, 17]이라 중앙값이 5다. 자르지 않으면 표본이 셋으로 부풀고 중앙값이 9로 옮겨 간다.
      expect(all.auctions[0]!.orgSummary).toMatchObject({
        attemptCount: 2,
        medianListCount: 5,
        listCountSampleCount: 2,
        lastRound: {
          auctionAttemptId: 102n,
          awardedBidRate: null,
          dayFloorBidRate: "88.0350",
          listCount: 17,
          belowDayFloorCount: 2,
        },
      });
      expect(all.auctions[0]!.orgSummary!.lastRound!.openedAt.toString()).toBe("2026-09-04T05:00:00Z");
      // 상세가 없는 202는 파생 열이 전부 null이고, 회차 요약이 없는 기관 43은 요약이 null이다.
      expect(all.auctions[1]).toMatchObject({
        organization: { organizationId: 43n, label: "다른 학교", type: "school" },
        itemLabel: null,
        displayBidNo: null,
        floorRate: null,
        region: null,
        termsRevisionId: null,
        orgSummary: null,
      });
      // 라벨이 관측되지 않은 시군구 코드는 참조는 살고 라벨만 null이다.
      expect(all.auctions[2]!.region!.sigungu).toEqual({
        codeValueId: 44n, code: "48250", scheme: "eat:auction-location-sigungu", label: null,
      });
      // 205는 하한율 88.000인데 기관 41의 회차는 전부 90.000이다. 다른 판의 값을 붙이지 않고 회차 0건으로 남는다.
      expect(all.auctions[2]!.orgSummary)
        .toEqual({ attemptCount: 0, medianListCount: null, listCountSampleCount: 0, lastRound: null });
      expect(all.auctions[3]).toMatchObject({ organization: null, closesAt: null, orgSummary: null });
      expect(all.snapshotLineage).toMatchObject({ buildId: 601n, calcVersion: "mart-r2", coverage: "partial" });
      expect(all.orgSummaryLineage).toMatchObject({ buildId: 501n, calcVersion: "mart-r1", coverage: "unknown" });

      // 기간 필터는 마감 미확인 행을 제외한다.
      expect(ids(pageOf(await reader.listOpen({ ...baseQuery, closesWithinHours: 24 })))).toEqual([201n]);
      expect(ids(pageOf(await reader.listOpen({ ...baseQuery, closesWithinHours: 72 })))).toEqual([201n, 202n]);
      // 기초금액 경계는 양끝을 포함한다.
      const upTo = pageOf(await reader.listOpen({ ...baseQuery, baseAmountMax: "2761700.00" }));
      expect(ids(upTo)).toEqual([201n, 203n]);
      expect(upTo.sampleCount).toBe(2);
      expect(ids(pageOf(await reader.listOpen({ ...baseQuery, baseAmountMin: "3000000.00" })))).toEqual([202n, 205n]);
      // 지역은 시도 하나가 담는 그릇이고 시군구가 그 안에서 좁힌다. 시군구를 비우면 시도 전체다.
      expect(ids(pageOf(await reader.listOpen({ ...baseQuery, sidoCodeValueId: 41n })))).toEqual([201n, 205n]);
      expect(ids(pageOf(await reader.listOpen({
        ...baseQuery, sidoCodeValueId: 41n, sigunguCodeValueIds: [43n],
      })))).toEqual([201n]);
      // 같은 시도 안에서 시군구 둘을 고르면 합집합이다. 공고 하나에 시군구가 하나라 겹쳐 세지 않는다.
      expect(ids(pageOf(await reader.listOpen({
        ...baseQuery, sidoCodeValueId: 41n, sigunguCodeValueIds: [43n, 44n],
      })))).toEqual([201n, 205n]);
      // KST 달력일 축은 시간 창과 다른 것을 센다. 201은 09-07 14:00(KST) 마감이고 205는 09-10이다.
      expect(ids(pageOf(await reader.listOpen({ ...baseQuery, closesOnKst: "2026-09-07" })))).toEqual([201n]);
      expect(ids(pageOf(await reader.listOpen({ ...baseQuery, closesOnKst: "2026-09-10" })))).toEqual([205n]);
      // 게시일 축은 마감 축과 다른 것을 센다. 201은 09-07 게시에 09-07 마감, 205는 09-05 게시에 09-10 마감이다.
      expect(ids(pageOf(await reader.listOpen({ ...baseQuery, announcedOnKst: "2026-09-07" })))).toEqual([201n]);
      expect(ids(pageOf(await reader.listOpen({ ...baseQuery, announcedOnKst: "2026-09-05" })))).toEqual([205n]);
      // 게시일을 관측하지 못한 행은 어느 게시일로도 안 걸린다. 빈 값을 오늘로 채워 읽지 않는다(AGENTS 3).
      expect(ids(pageOf(await reader.listOpen({ ...baseQuery, announcedOnKst: "2026-09-08" })))).toEqual([]);
      // 품목은 다리표의 원자 코드 조인이다. 합성 라벨(`육류 , 가금류`) 행은 두 원자 어느 쪽으로도 걸린다(EAT-230).
      expect(ids(pageOf(await reader.listOpen({ ...baseQuery, itemAtoms: ["육류"] })))).toEqual([201n, 205n]);
      expect(ids(pageOf(await reader.listOpen({ ...baseQuery, itemAtoms: ["가금류"] })))).toEqual([201n, 205n]);
      // 원자 여럿은 OR이고, 원자가 하나도 없는 202·203은 어느 원자로도 안 걸린다.
      expect(ids(pageOf(await reader.listOpen({ ...baseQuery, itemAtoms: ["수산물", "가금류"] })))).toEqual([201n, 205n]);
      expect(ids(pageOf(await reader.listOpen({ ...baseQuery, itemAtoms: ["수산물"] })))).toEqual([]);
      // 어휘 밖 문자열(`축`)은 여기까지 오지 않는다 — 계약이 원자 enum이라 controller에서 400이다(list-open-auctions.response.test).

      // cursor 페이지 둘을 이어 붙여도 순서와 중복이 없고 표본 수는 cursor 위치와 무관하다.
      const first = pageOf(await reader.listOpen({ ...baseQuery, limit: 2 }));
      expect(ids(first)).toEqual([201n, 202n]);
      expect(first.nextCursor).toBe(202n);
      expect(first.sampleCount).toBe(4);
      const second = pageOf(await reader.listOpen({ ...baseQuery, limit: 2, cursor: first.nextCursor }));
      expect(ids(second)).toEqual([205n, 203n]);
      expect(second.nextCursor).toBeNull();
      expect(second.sampleCount).toBe(4);
      // 마감된 공고와 없는 공고를 가리키는 cursor는 빈 페이지가 아니라 명시적 실패다.
      expect(await reader.listOpen({ ...baseQuery, cursor: 204n })).toEqual({ kind: "cursor-not-found", cursor: 204n });
      expect(await reader.listOpen({ ...baseQuery, cursor: 9_007_199_254_740_993n }))
        .toEqual({ kind: "cursor-not-found", cursor: 9_007_199_254_740_993n });

      const runtime = await createApp({
        environment: parseEnvironment({ NODE_ENV: "test", PORT: "0", DATABASE_URL: apiUrl }),
        logWriter: () => undefined,
        clock: fixedClock(NOW),
        sessionAuthenticator: signedInSessionAuthenticator,
      });
      const server = await runtime.listen(0, "127.0.0.1");
      try {
        const response = await request(server).get(
          auctionV1Operations.listOpen.buildPath({ path: {}, query: { limit: 1, items: ["육류"] } }),
        );
        expect(response.status).toBe(200);
        expect(response.body.auctions.map((auction: { auctionAttemptId: string }) => auction.auctionAttemptId)).toEqual(["201"]);
        expect(response.body.nextCursor).toBe("201");
        expect(response.body.meta).toEqual({
          sampleCount: 2,
          asOf: "2026-09-07T01:00:00Z",
          sido: null,
          sigungu: null,
          // 참가제한지역으로 좁히지 않은 요청이라 세 값이 모두 null이다. 0이 아니다 — 0은 "걸렀는데
          // 하나도 없다"는 사실이고 null은 "그 축으로 묻지 않았다"는 뜻이다(ADR 0048 결정 3).
          eligibilityArea: null,
          eligibilityMatchedCount: null,
          eligibilityUnobservedCount: null,
          items: ["육류"],
          itemUnknown: null,
          q: null,
          bidState: null,
          closesWithinHours: null,
          closesOn: null,
          announcedOn: null,
          baseAmountMin: null,
          baseAmountMax: null,
          openAuctionSnapshotBuild: {
            buildId: "601",
            sourceReleaseId: "00000000-0000-0000-0000-000000000141",
            calcVersion: "mart-r2",
            computedAt: "2026-09-07T00:10:00Z",
            coverage: "partial",
            regionScheme: "eat:auction-location-sigungu",
          },
          orgRoundSummaryBuild: {
            buildId: "501",
            sourceReleaseId: "00000000-0000-0000-0000-000000000141",
            calcVersion: "mart-r1",
            computedAt: "2026-09-07T00:10:00Z",
            coverage: "unknown",
            regionScheme: null,
          },
        });
        const staleCursor = await request(server).get(
          auctionV1Operations.listOpen.buildPath({ path: {}, query: { cursor: "204" } }),
        );
        expect(staleCursor.status).toBe(400);
        expect(staleCursor.body.code).toBe("VALIDATION_ERROR");
      } finally {
        await runtime.shutdown();
      }
    });
    await expectOwnedContainersCleanedUp();
  }, 180_000);
});

describe("mart 열린 공고 요약 PostgreSQL 경계", () => {
  test("요약과 목록이 같은 필터 위에서 같은 수를 세고 달력은 0건인 날도 칸을 남긴다", async () => {
    await withDatabase(async ({ api }) => {
      const database = drizzle({ client: api });
      const summaryReader = new DrizzleOpenAuctionSummaryReader(database);
      const listReader = new DrizzleOpenAuctionReader(database);
      const summaryQuery: OpenAuctionSummaryQuery = {
        asOf: NOW,
        sidoCodeValueId: null,
        sigunguCodeValueIds: null,
        eligibilityAreaCodeValueIds: null,
        itemAtoms: null,
        includeUnknownItem: false,
        searchText: null,
        baseAmountMin: null,
        baseAmountMax: null,
        calendarFrom: "2026-09-07",
        calendarTo: "2026-09-10",
      };

      const summary = await summaryReader.summarizeOpen(summaryQuery);

      // 두 조회가 같은 열림 판정을 써야 축 줄의 건수와 목록의 행이 같은 코호트를 말한다. 취소된 206과
      // 이미 마감된 204는 양쪽 모두에서 빠진다.
      expect(summary.totalCount).toBe(pageOf(await listReader.listOpen(baseQuery)).sampleCount);
      expect(summary.totalCount).toBe(4);
      // 201·205는 기관 41, 202는 43, 203은 기관 미확인이라 기관 수는 행 수보다 적다.
      expect(summary.organizationCount).toBe(2);
      // 201이 09-07 14:00(KST) 마감이고 NOW가 같은 날 10시다. 205는 09-10, 202는 09-08이다.
      expect(summary.closingTodayCount).toBe(1);
      // 201만 게시일이 KST 09-07이다. 취소된 206도 같은 날 게시됐지만 열린 집합에 없어 안 센다.
      expect(summary.openedTodayCount).toBe(1);
      // 202·203은 게시일을 관측하지 못했다. 못 센 수를 함께 내야 화면이 이 1건을 부분 집계로 말한다.
      expect(summary.announcedUnobservedCount).toBe(2);
      expect(summary.nextClosingDay).toEqual({ date: "2026-09-07", count: 1 });

      // 창의 날짜를 전부 낸다. 09-09는 한 건도 없지만 칸이 사라지지 않는다.
      expect(summary.calendar.map((day) => [day.date, day.count])).toEqual([
        ["2026-09-07", 1], ["2026-09-08", 1], ["2026-09-09", 0], ["2026-09-10", 1],
      ]);
      // 마감을 관측하지 못한 203은 어느 칸에도 안 들어가므로 칸의 합이 전체보다 작을 수 있다.
      expect(summary.calendar.reduce((sum, day) => sum + day.count, 0)).toBe(3);

      // 하한율이 갈리면 그날 하한이 다른 자리에 서는 다른 판이다. 관측 못 한 행도 버리지 않고 센다.
      // 순서는 많은 것부터이고 동률은 하한율 오름차순으로 끊는다. 화면이 드문 쪽을 고를 수 있으려면
      // 이 순서가 실행마다 같아야 한다.
      expect(summary.floorShares.map((share) => [share.rate === null ? null : String(share.rate), share.count]))
        .toEqual([[null, 2], ["88.000", 1], ["90.000", 1]]);
      expect(summary.floorShares.reduce((sum, share) => sum + share.count, 0)).toBe(summary.totalCount);

      // 조건 기둥의 배지다. 조건이 없으니 지역 축을 푼 집합은 열린 넷 그대로이고, 시도가 있는 201·205만
      // 시도 41에 서며 202·203은 지역 미상이다. 시도를 안 골랐으므로 시군구는 세우지 않는다.
      expect(summary.sidoCounts).toEqual([
        { codeValueId: 41n, code: "48", scheme: "eat:auction-location-sido", label: "경상남도", count: 2 },
      ]);
      expect(summary.sigunguCounts).toEqual([]);
      expect(summary.regionUnobservedCount).toBe(2);
      // 여덟 원자가 어휘 순서대로 전부 온다. 합성 라벨(`육류 , 가금류`)의 201·205가 두 원자에 각각 한 번씩 서고
      // 0건 원자도 항목으로 남는다 — 화면이 "오늘 없다"와 "어휘에 없다"를 갈라야 한다(EAT-230).
      expect(summary.itemCounts.map((entry) => [entry.item, entry.count])).toEqual([
        ["육류", 2], ["가금류", 2], ["농산물", 0], ["수산물", 0], ["가공식품", 0], ["김치류", 0], ["곡류", 0], ["우유류", 0],
      ]);
      expect(summary.itemUnobservedCount).toBe(2);
    });
    await expectOwnedContainersCleanedUp();
  }, 180_000);

  test("지역과 품목으로 좁히면 요약과 목록이 함께 줄고 푼 수는 지역만 남긴 수다", async () => {
    await withDatabase(async ({ api }) => {
      const database = drizzle({ client: api });
      const summaryReader = new DrizzleOpenAuctionSummaryReader(database);
      const listReader = new DrizzleOpenAuctionReader(database);
      const scoped: OpenAuctionSummaryQuery = {
        asOf: NOW,
        sidoCodeValueId: 41n,
        sigunguCodeValueIds: null,
        eligibilityAreaCodeValueIds: null,
        itemAtoms: ["육류"],
        includeUnknownItem: false,
        searchText: null,
        baseAmountMin: null,
        baseAmountMax: null,
        calendarFrom: "2026-09-07",
        calendarTo: "2026-09-10",
      };

      const summary = await summaryReader.summarizeOpen(scoped);
      const list = pageOf(await listReader.listOpen({
        ...baseQuery, sidoCodeValueId: 41n, itemAtoms: ["육류"],
      }));

      expect(summary.totalCount).toBe(list.sampleCount);
      expect(summary.totalCount).toBe(2);
      // `releasedCount`는 지역 축만 남기고 품목을 푼 수다. 화면의 `1건 · 1건 중`이 그 둘이며 푼 수가
      // 건 수보다 작아지면 그 문장이 거짓이 된다.
      for (const day of summary.calendar) {
        expect(day.releasedCount).toBeGreaterThanOrEqual(day.count);
      }
      // 09-07은 축산 201 하나이고 시도 41에는 그날 다른 품목이 없어 둘이 같다.
      expect(summary.calendar[0]).toEqual({ date: "2026-09-07", count: 1, releasedCount: 1 });

      // 배지는 그 축 하나만 푼 수다. 시도 배지는 품목 `축산`을 유지한 채 지역을 푼 수라 201·205의 2이고,
      // 시군구는 고른 시도 41 안에서만 선다 — 44는 라벨이 관측되지 않았지만 항목으로 남는다(AGENTS 3).
      // 순서는 많은 것부터, 동률은 코드 순이다.
      expect(summary.sidoCounts.map((entry) => [entry.code, entry.count])).toEqual([["48", 2]]);
      expect(summary.sigunguCounts).toEqual([
        { codeValueId: 43n, code: "48120", scheme: "eat:auction-location-sigungu", label: "창원시", count: 1 },
        { codeValueId: 44n, code: "48250", scheme: "eat:auction-location-sigungu", label: null, count: 1 },
      ]);
      expect(summary.regionUnobservedCount).toBe(0);
      // 품목 배지는 지역 41을 유지한 채 품목을 푼 수다. 그 집합(201·205)에는 라벨 없는 행이 없다.
      expect(summary.itemUnobservedCount).toBe(0);

      // `품목 미상 포함`은 목록과 같은 술어다. 지역을 풀고 축산 + 미상을 세면 라벨 없는 202·203이 함께 들어와
      // 넷이 되고, 이 수가 목록의 행 수와 같아야 탭·달력·배지가 표와 다른 말을 하지 않는다.
      const withUnknown = await summaryReader.summarizeOpen({
        ...scoped, sidoCodeValueId: null, includeUnknownItem: true,
      });
      expect(withUnknown.totalCount).toBe(4);
      expect(withUnknown.totalCount).toBe(pageOf(await listReader.listOpen({
        ...baseQuery, itemAtoms: ["육류"], includeUnknownItem: true,
      })).sampleCount);
    });
    await expectOwnedContainersCleanedUp();
  }, 180_000);

  test("검색어는 제목·기관 이름·공고번호 안에서 부분일치로 찾고 요약과 목록이 같은 수를 센다", async () => {
    await withDatabase(async ({ api }) => {
      const database = drizzle({ client: api });
      const listReader = new DrizzleOpenAuctionReader(database);
      const summaryReader = new DrizzleOpenAuctionSummaryReader(database);
      const search = (searchText: string) => listReader.listOpen({ ...baseQuery, searchText });

      // 제목으로 — `재공고`는 205의 제목에만 있다. 취소분 206도 제목이 걸리지만 열린 공고가 아니라 빠진다.
      expect(ids(pageOf(await search("재공고")))).toEqual([205n]);
      // 공고번호로 — eaT에서 본 번호를 붙여 넣는 길이다. 물린 build(602)의 같은 번호는 안 걸린다.
      expect(ids(pageOf(await search("2026-0201")))).toEqual([201n]);
      // 기관 이름으로 — 202는 상세를 아직 안 따 제목·번호가 없지만 기관 라벨이 있어 걸린다.
      expect(ids(pageOf(await search("다른 학교")))).toEqual([202n]);
      // 셋 다 없는 203은 어떤 검색어로도 안 걸린다. 못 찾은 것이지 안 맞는 것이 아니다(AGENTS 3).
      expect(ids(pageOf(await search("500000")))).toEqual([]);
      // `like` 메타문자는 글자다. `%`를 적으면 "무엇이든"이 아니라 `%`가 든 제목을 찾는다.
      expect(ids(pageOf(await search("%")))).toEqual([]);

      // 요약은 목록과 같은 술어를 쓴다. 검색 중에 탭·달력·배지가 검색 전 집합을 세면 표와 다른 말을 한다.
      const summary = await summaryReader.summarizeOpen({
        asOf: NOW,
        sidoCodeValueId: null,
        sigunguCodeValueIds: null,
        eligibilityAreaCodeValueIds: null,
        itemAtoms: null,
        includeUnknownItem: false,
        searchText: "남산초",
        baseAmountMin: null,
        baseAmountMax: null,
        calendarFrom: "2026-09-07",
        calendarTo: "2026-09-10",
      });
      const list = pageOf(await search("남산초"));
      expect(ids(list)).toEqual([201n, 205n]);
      expect(summary.totalCount).toBe(list.sampleCount);
      // 검색은 어느 배지에서도 풀리지 않는다. 시도 배지가 검색을 풀고 세면 4가 되어 누르면 되는 수가 아니다.
      expect(summary.sidoCounts.map((entry) => [entry.code, entry.count])).toEqual([["48", 2]]);
    });
    await expectOwnedContainersCleanedUp();
  }, 180_000);
});
