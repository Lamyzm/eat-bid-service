// docker PostgreSQL이 필요한 통합 테스트이며 `open-auctions.integration.test.ts`와 같은 공용 harness·관행을 따른다.
import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import { maxFilterCombinations } from "@eatbid/contracts";
import { Temporal } from "@eatbid/domain";

import type { FilterCombinationFilterRecord } from "../modules/account/application/filter-combination-repository";
import { DrizzleFilterCombinationRepository } from "../modules/account/infrastructure/drizzle/drizzle-filter-combination-repository";
import type { OpenAuctionFilterCountsQuery } from "../modules/procurement/application/count-open-auctions-for-filters";
import { DrizzleOpenAuctionFilterCountsReader } from "../modules/procurement/infrastructure/drizzle/drizzle-open-auction-filter-counts-reader";
import { disposableDatabase } from "../../fixtures/disposable-database.fixture";

/**
 * 시나리오: 워크스페이스 1이 관심 지역으로 경남/전체(9101)를 골랐다. 열린 공고 다섯 중 701·702는 경남
 * 시도(41)이고 703은 다른 시도, 704는 이미 마감, 705는 취소다. 701만 오늘 마감이고 702는 참여 0이며
 * 703은 품목 라벨을 관측하지 못했다.
 */
const NOW = Temporal.Instant.from("2026-09-07T01:00:00Z");

const seed = `
  insert into app.principal (principal_id) overriding system value values (1);
  insert into app.workspace (workspace_id, name) overriding system value values (1, '내 워크스페이스');
  insert into app.workspace_membership (workspace_id, principal_id, role) values (1, 1, 'owner');
  insert into core.code_scheme (code_scheme_id, namespace, owner, version_policy, valid_time_policy)
  overriding system value
  values (11, 'eat:auction-location-sido', 'eat', 'immutable', 'open'),
         (12, 'eat:auction-location-sigungu', 'eat', 'immutable', 'open'),
         (21, 'eat:eligibility-area', 'eat', 'immutable', 'open'),
         -- 품목 원자 체계는 운영에서 시드가 심지만 이 seed의 다리표 삽입이 그보다 먼저 돌므로 여기서도 심는다.
         (13, 'eatbid:auction-item', 'eatbid', 'product-managed', 'effective-dated');
  insert into core.code_value (code_value_id, code_scheme_id, code)
  overriding system value
  values (41, 11, '48'), (42, 11, '47'), (43, 12, '48120'), (44, 12, '48250'),
         (9101, 21, '15000'),
         (51, 13, '육류'), (52, 13, '가금류'), (53, 13, '농산물'), (54, 13, '수산물'),
         (55, 13, '가공식품'), (56, 13, '김치류'), (57, 13, '곡류'), (58, 13, '우유류');
  insert into core.auction_attempt (auction_attempt_id, source_system, external_bid_id)
  overriding system value
  values (701, 'eat', 'external-701'), (702, 'eat', 'external-702'), (703, 'eat', 'external-703'),
         (704, 'eat', 'external-704'), (705, 'eat', 'external-705');
  insert into ingest.run
    (run_id, mode, status, build_sha, parser_version, started_at, ended_at,
     failure_category, expected_count, captured_count, published_count)
  values
    ('00000000-0000-0000-0000-000000000191', 'capture', 'published', '${"a".repeat(64)}',
     'eat-v2', '2026-09-03T00:00:00Z', '2026-09-03T00:01:00Z', null, 1, 1, 1);
  insert into ingest.request_unit
    (request_unit_id, run_id, source, endpoint, request_params, request_params_hash,
     expected_count, observed_count, status)
  overriding system value
  values (391, '00000000-0000-0000-0000-000000000191', 'eat', 'bid-list', '{}',
    '${"b".repeat(64)}', 1, 1, 'captured');
  insert into ingest.raw_blob
    (content_sha256, object_key, byte_length, content_type, content_encoding, stored_at)
  values ('${"c".repeat(64)}', 'raw/eat/bid-list/${"c".repeat(64)}.xml.gz', 10,
    'application/xml', 'gzip', '2026-09-03T00:00:30Z');
  insert into ingest.raw_observation
    (observation_id, run_id, request_unit_id, source, endpoint, request_params,
     fetched_at, http_status, content_sha256)
  overriding system value
  values (393, '00000000-0000-0000-0000-000000000191', 391, 'eat', 'bid-list', '{}',
    '2026-09-07T00:30:00Z', 200, '${"c".repeat(64)}');
  insert into ingest.normalized_record
    (normalized_record_id, observation_id, record_type, source_entity_id, normalized_payload,
     parser_version, normalized_at)
  overriding system value
  values (491, 393, 'auction.v2', 'external-701', '{}', 'eat-v2', '2026-09-03T00:00:40Z'),
         (492, 393, 'auction.v2', 'external-702', '{}', 'eat-v2', '2026-09-03T00:00:40Z'),
         (493, 393, 'auction.v2', 'external-703', '{}', 'eat-v2', '2026-09-03T00:00:40Z'),
         (494, 393, 'auction.v2', 'external-704', '{}', 'eat-v2', '2026-09-03T00:00:40Z'),
         (495, 393, 'auction.v2', 'external-705', '{}', 'eat-v2', '2026-09-03T00:00:40Z');
  insert into core.auction_revision
    (auction_revision_id, auction_attempt_id, normalized_record_id, observation_id,
     content_sha256, display_bid_no, source_status, title, announced_at, deadline_at,
     opened_at, base_amount, planned_amount, currency, source_payload)
  overriding system value
  values (801, 701, 491, 393, '${"1".repeat(64)}', null, 'OPEN', '육류 구매',
    '2026-09-05T00:00:00Z', '2026-09-07T05:00:00Z', null, 2000000.00, null, 'KRW', '{}'),
         (802, 702, 492, 393, '${"2".repeat(64)}', null, 'OPEN', '수산물 구매',
    '2026-09-05T00:00:00Z', '2026-09-08T05:00:00Z', null, 50000000.00, null, 'KRW', '{}'),
         (803, 703, 493, 393, '${"3".repeat(64)}', null, 'OPEN', '구매',
    '2026-09-05T00:00:00Z', '2026-09-09T05:00:00Z', null, 3000000.00, null, 'KRW', '{}'),
         (804, 704, 494, 393, '${"4".repeat(64)}', null, 'OPEN', '육류 구매',
    '2026-09-05T00:00:00Z', '2026-09-06T05:00:00Z', null, 1000000.00, null, 'KRW', '{}'),
         (805, 705, 495, 393, '${"5".repeat(64)}', null, 'OPEN', '육류 구매',
    '2026-09-05T00:00:00Z', '2026-09-10T05:00:00Z', null, 1000000.00, null, 'KRW', '{}');
  insert into ingest.source_release (source_release_id, source, release_name, status, as_of)
  values ('00000000-0000-0000-0000-000000000191', 'eat', 'eat-2026-09-07', 'planned',
    '2026-09-07T00:00:00Z');
  insert into mart.build
    (build_id, mart_name, source_release_id, calc_version, builder_version, region_scheme,
     status, as_of, started_at)
  overriding system value
  values (901, 'open_auction_snapshot', '00000000-0000-0000-0000-000000000191', 'mart-r2',
    '${"a".repeat(40)}', 'eat:auction-location-sigungu', 'building', '2026-09-07T00:00:00Z',
    '2026-09-07T00:05:00Z');
  insert into mart.open_auction_snapshot
    (build_id, auction_attempt_id, observed_at, observation_id, organization_id, bid_count, closes_at,
     base_amount, currency, item_label, floor_rate, region_sido_code_value_id,
     region_sigungu_code_value_id, terms_revision_id, source_status_label, title)
  values
    (901, 701, '2026-09-07T00:30:00Z', 393, null, 3, '2026-09-07T05:00:00Z',
     2000000.00, 'KRW', '육류 , 가금류', 90.000, 41, 43, 801, '진행중', '합성 육류 급식'),
    (901, 702, '2026-09-07T00:30:00Z', 393, null, 0, '2026-09-08T05:00:00Z',
     50000000.00, 'KRW', '수산물', 90.000, 41, 44, 802, '진행중', '합성 수산 급식'),
    (901, 703, '2026-09-07T00:30:00Z', 393, null, 2, '2026-09-09T05:00:00Z',
     3000000.00, 'KRW', null, 90.000, 42, null, 803, null, null),
    (901, 704, '2026-09-07T00:30:00Z', 393, null, 1, '2026-09-06T05:00:00Z',
     1000000.00, 'KRW', '육류', 90.000, 41, 43, 804, '진행중', '합성 육류 급식'),
    (901, 705, '2026-09-07T00:30:00Z', 393, null, 1, '2026-09-10T05:00:00Z',
     1000000.00, 'KRW', '육류', 90.000, 41, 43, 805, '공고취소', '합성 육류 급식');
  insert into mart.open_auction_snapshot_item (open_auction_snapshot_id, item_code_value_id)
  select snapshot.open_auction_snapshot_id, value.code_value_id
    from mart.open_auction_snapshot snapshot
    cross join lateral unnest(string_to_array(snapshot.item_label, ',')) as part
    join core.code_value value on value.code = btrim(part)
    join core.code_scheme scheme
      on scheme.code_scheme_id = value.code_scheme_id and scheme.namespace = 'eatbid:auction-item'
   where snapshot.build_id in (901);
  insert into mart.build_coverage
    (build_id, region_code_value_id, month_kst, expected_count, observed_count,
     normalized_count, quarantined_count, coverage)
  values (901, null, '2026-09-01', 5, 5, 5, 0, 'partial');
  update mart.build set status = 'verified', computed_at = '2026-09-07T00:10:00Z', row_count = 5
   where build_id = 901;
  update mart.build set status = 'active', activated_at = '2026-09-07T00:11:00Z' where build_id = 901;
`;

const { withDatabase, expectOwnedContainersCleanedUp } = disposableDatabase({
  task: "filter-combinations",
  migrationApplyCount: 1,
  seed: async (owner) => { await owner.unsafe(seed); },
});

const emptyFilter: FilterCombinationFilterRecord = {
  sidoCodeValueId: null,
  sigunguCodeValueIds: [],
  itemAtoms: [],
  baseAmountMin: null,
  baseAmountMax: null,
};

const baseCounts: Omit<OpenAuctionFilterCountsQuery, "current" | "saved"> = {
  asOf: NOW,
  // 워크스페이스가 확인한 관심 지역이다. 이 스냅샷 행은 상세가 없어 제한지역이 전부 미관측이라
  // "미관측은 숨기지 않는다" 규칙에 따라 다섯이 모두 바닥에 남는다.
  eligibilityAreaCodeValueIds: [9_101n],
};

describe("저장된 조건 조합 PostgreSQL 경계", () => {
  test("상한 다섯을 트랜잭션 안에서 막고 같은 이름을 두 번 저장하지 않는다", async () => {
    await withDatabase(async ({ api }) => {
      const repository = new DrizzleFilterCombinationRepository(drizzle({ client: api }));

      for (let index = 0; index < maxFilterCombinations; index += 1) {
        const saved = await repository.saveCombination({
          workspaceId: 1n,
          principalId: 1n,
          name: `조합 ${index}`,
          filter: emptyFilter,
        });
        expect(saved.kind).toBe("saved");
      }

      // 여섯째는 거절되고, 그 뒤 조회가 정상으로 다섯을 돌려준다. 상한을 저장과 조회가 다른 수로 알면
      // 저장은 성공하고 조회가 자기 응답 검증에서 깨져 사용자가 정상 상태를 아예 못 읽게 된다.
      const overflow = await repository.saveCombination({
        workspaceId: 1n, principalId: 1n, name: "여섯째", filter: emptyFilter,
      });
      expect(overflow.kind).toBe("limit-reached");
      expect((await repository.listCombinations(1n)).length).toBe(maxFilterCombinations);

      // 자리를 비우고 같은 이름을 다시 넣으면 중복이다. 건수가 같은 두 조합이 서로 다른 이름으로 서
      // 있으면 같은 조건에 두 이름을 붙인 것이고, 이름이 같으면 어느 쪽을 누르는지 알 수 없다.
      const combinations = await repository.listCombinations(1n);
      const first = combinations[0]!;
      expect((await repository.deleteCombination({ workspaceId: 1n, filterCombinationId: first.filterCombinationId })).kind)
        .toBe("deleted");
      const duplicate = await repository.saveCombination({
        workspaceId: 1n, principalId: 1n, name: combinations[1]!.name, filter: emptyFilter,
      });
      expect(duplicate.kind).toBe("duplicate-name");
    });
    await expectOwnedContainersCleanedUp();
  }, 300_000);

  test("남의 워크스페이스 조합은 목록에도 없고 삭제도 없다고 답한다", async () => {
    await withDatabase(async ({ api, owner }) => {
      await owner.unsafe(`
        insert into app.principal (principal_id) overriding system value values (2);
        insert into app.workspace (workspace_id, name) overriding system value values (2, '남의 워크스페이스');
        insert into app.workspace_membership (workspace_id, principal_id, role) values (2, 2, 'owner');
      `);
      const repository = new DrizzleFilterCombinationRepository(drizzle({ client: api }));
      const mine = await repository.saveCombination({
        workspaceId: 1n, principalId: 1n, name: "내 조합", filter: emptyFilter,
      });
      expect(mine.kind).toBe("saved");

      expect(await repository.listCombinations(2n)).toEqual([]);
      // 403이 아니라 "없다"로 답한다. 403은 그 id가 존재한다는 사실을 알려 준다.
      const id = mine.kind === "saved" ? mine.combination.filterCombinationId : 0n;
      expect((await repository.deleteCombination({ workspaceId: 2n, filterCombinationId: id })).kind)
        .toBe("not-found");
      expect((await repository.listCombinations(1n)).length).toBe(1);
    });
    await expectOwnedContainersCleanedUp();
  }, 300_000);

  test("필터 atom 한 벌이 자식 표까지 그대로 돌아온다", async () => {
    await withDatabase(async ({ api }) => {
      const repository = new DrizzleFilterCombinationRepository(drizzle({ client: api }));
      const filter: FilterCombinationFilterRecord = {
        sidoCodeValueId: 41n,
        sigunguCodeValueIds: [43n, 44n],
        itemAtoms: ["육류", "가금류"],
        baseAmountMin: "1000000.00",
        baseAmountMax: "30000000.00",
      };
      const saved = await repository.saveCombination({
        workspaceId: 1n, principalId: 1n, name: "김해 축산", filter,
      });
      expect(saved.kind).toBe("saved");

      const [read] = await repository.listCombinations(1n);
      expect(read!.name).toBe("김해 축산");
      // 저장하는 것은 이름 하나와 필터 atom 한 벌이다. 건수·라벨·묶음 이름은 여기 없다.
      //
      // 자식 둘은 집합이라(PK가 (조합, 값)) 적은 순서가 사실이 아니다. 정렬해 돌려주는 이유는 같은 조건을
      // 저장한 두 조합이 같은 주소를 만들게 하기 위해서다 — 순서만 다른 두 URL은 같은 목록을 두 자리로
      // 쪼개고 캐시도 둘이 된다.
      expect(read!.filter).toEqual({ ...filter, itemAtoms: ["가금류", "육류"] });
    });
    await expectOwnedContainersCleanedUp();
  }, 300_000);

  test("조합 아홉의 건수가 한 번의 조회에서 같은 기준 시각으로 나온다", async () => {
    await withDatabase(async ({ api }) => {
      const database = drizzle({ client: api });
      const repository = new DrizzleFilterCombinationRepository(database);
      const reader = new DrizzleOpenAuctionFilterCountsReader(database);

      await repository.saveCombination({
        workspaceId: 1n,
        principalId: 1n,
        name: "경남만",
        filter: { ...emptyFilter, sidoCodeValueId: 41n },
      });
      await repository.saveCombination({
        workspaceId: 1n,
        principalId: 1n,
        name: "큰 건",
        filter: { ...emptyFilter, baseAmountMin: "10000000.00" },
      });
      const saved = await repository.listCombinations(1n);

      const counts = await reader.countForFilters({
        ...baseCounts,
        // 지금 화면 조건은 경남 시도에 품목 `육류`다.
        current: {
          sidoCodeValueId: 41n,
          sigunguCodeValueIds: null,
          itemAtoms: ["육류"],
          searchText: null,
          baseAmountMin: null,
          baseAmountMax: null,
        },
        saved: saved.map((combination) => ({
          sidoCodeValueId: combination.filter.sidoCodeValueId,
          sigunguCodeValueIds: combination.filter.sigunguCodeValueIds,
          itemAtoms: combination.filter.itemAtoms.length === 0 ? null : combination.filter.itemAtoms,
          searchText: null,
          baseAmountMin: combination.filter.baseAmountMin,
          baseAmountMax: combination.filter.baseAmountMax,
        })),
      } satisfies OpenAuctionFilterCountsQuery);

      // 열린 것은 셋이다. 704는 이미 마감이고 705는 취소라 바닥에서 빠진다 — 목록과 같은 열림 술어다.
      expect(counts.regionAll).toBe(3);
      // 701만 오늘(KST 09-07) 마감이다.
      expect(counts.regionClosingToday).toBe(1);
      // 지금 조건(경남 + 육류)에서 참여 0인 판. 701은 참여 3이고 702는 품목이 수산물이라 조건 밖이다.
      expect(counts.noBids).toBe(0);
      // 지금 조건에 라벨 미관측을 더한 수. 701(육류 , 가금류)에 703(미관측)이 붙는다 — 703은 다른
      // 시도라 시도 축에서 빠지므로 결국 701 하나다.
      expect(counts.itemUnknownIncluded).toBe(1);
      // 저장 순서 그대로 짝지어 온다. 이름이 아니라 위치가 유일한 연결이다.
      expect(counts.saved).toEqual([2, 1]);
      expect(counts.snapshotLineage?.buildId).toBe(901n);

      // 검색도 지금 화면 조건이다. `참여 0곳`·`품목 미상 포함` 링크는 검색어를 이어 가므로 그 수도 검색 안에서
      // 세고, 관심 지역 둘과 저장 조합은 검색을 버리는 링크라 수가 그대로다(EAT-247).
      const searched = await reader.countForFilters({
        ...baseCounts,
        current: {
          sidoCodeValueId: 41n,
          sigunguCodeValueIds: null,
          itemAtoms: null,
          searchText: "수산",
          baseAmountMin: null,
          baseAmountMax: null,
        },
        saved: [{ ...emptyFilter, sigunguCodeValueIds: null, itemAtoms: null, searchText: null, sidoCodeValueId: 41n }],
      } satisfies OpenAuctionFilterCountsQuery);
      expect(searched.regionAll).toBe(3);
      // 제목에 `수산`이 든 702만 남고, 702는 참여 0이라 `참여 0곳`도 1이다.
      expect(searched.noBids).toBe(1);
      expect(searched.itemUnknownIncluded).toBe(1);
      expect(searched.saved).toEqual([2]);
    });
    await expectOwnedContainersCleanedUp();
  }, 300_000);
});
