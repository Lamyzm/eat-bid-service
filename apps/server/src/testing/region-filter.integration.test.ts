// docker PostgreSQL이 필요한 통합 테스트이며 공용 `disposable-database.fixture.ts` harness를 그대로 쓴다.
// 조회 경로는 전부 실제 SQL이며 운영 최소 권한 역할(`api`)로 읽는다.
import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import { Effect } from "effect";
import { fixedClock, Temporal } from "@eatbid/domain";

import { DrizzleAccountRepository } from "../modules/account/infrastructure/drizzle/drizzle-account-repository";
import { DrizzleRegionPreferenceRepository } from "../modules/account/infrastructure/drizzle/drizzle-region-preference-repository";
import type { AccountDatabase } from "../modules/account/infrastructure/drizzle/account-sql";
import { DrizzleEligibilityAreaReader } from "../modules/procurement/infrastructure/drizzle/drizzle-eligibility-area-reader";
import { DrizzleOpenAuctionReader } from "../modules/procurement/infrastructure/drizzle/drizzle-open-auction-reader";
import type {
  OpenAuctionListing,
  OpenAuctionPage,
  OpenAuctionQuery,
} from "../modules/procurement/application/open-auction-reader";
import { PreviewRegionCoverage } from "../modules/procurement/application/preview-region-coverage";
import {
  CHANGWON,
  DAYS_WITH_AUCTIONS,
  GIMHAE,
  GYEONGBUK_ALL,
  GYEONGNAM_ALL,
  MEDIAN_DAY_COUNT,
  OPEN_ATTEMPT_IDS,
  PEAK_COUNT,
  PEAK_DATE,
  REGION_FILTER_NOW,
  regionFilterDatabase,
} from "../../fixtures/region-filter.fixture";

const NOW = Temporal.Instant.from(REGION_FILTER_NOW);
const { withDatabase, expectOwnedContainersCleanedUp } = regionFilterDatabase;

const baseQuery: OpenAuctionQuery = {
  asOf: NOW,
  regionCodeValueId: null,
  eligibilityAreaCodeValueIds: null,
  itemLabel: null,
  closesWithinHours: null,
  baseAmountMin: null,
  baseAmountMax: null,
  cursor: null,
  limit: 50,
};

function pageOf(listing: OpenAuctionListing): OpenAuctionPage {
  if (listing.kind !== "page") throw new Error(`expected a page but got ${listing.kind}`);
  return listing.page;
}

describe("참가제한지역 필터 PostgreSQL 경계", () => {
  test("김해시와 경남 전체를 고른 워크스페이스가 실측 구조 그대로 9건을 보고 창원 공고는 보지 않는다", async () => {
    await withDatabase(async ({ api }) => {
      const reader = new DrizzleOpenAuctionReader(drizzle({ client: api }));

      // 필터 없음: 전국이 그대로 보인다. 이 수가 화면이 말하는 분모다.
      const nationwide = pageOf(await reader.listOpen(baseQuery));
      expect(nationwide.sampleCount).toBe(OPEN_ATTEMPT_IDS.length);

      const gimhae = pageOf(await reader.listOpen({
        ...baseQuery,
        eligibilityAreaCodeValueIds: [GIMHAE, GYEONGNAM_ALL],
      }));
      // 김해로 못 박은 둘 + 도 전체로 열린 일곱 = 9. 실측 표의 `김해시 + 경남 전체` 칸과 같은 구조다.
      expect(gimhae.eligibilityMatchedCount).toBe(9);
      // 제한지역 미관측 일곱은 버리지 않고 목록에 남는다(ADR 0048 결정 3).
      expect(gimhae.eligibilityUnobservedCount).toBe(7);
      expect(gimhae.sampleCount).toBe(16);
      expect(gimhae.auctions).toHaveLength(16);

      const matched = gimhae.auctions.filter((auction) => auction.eligibilityAreas !== null);
      const unobserved = gimhae.auctions.filter((auction) => auction.eligibilityAreas === null);
      expect(matched).toHaveLength(9);
      expect(unobserved).toHaveLength(7);

      // 창원으로 못 박은 공고는 김해 설정에 들어오지 않는다.
      const areaIds = matched.flatMap((auction) => auction.eligibilityAreas!.map((area) => area.codeValueId));
      expect(areaIds).not.toContain(CHANGWON);
      // 도 전체로 제한된 공고는 들어온다.
      expect(areaIds).toContain(GYEONGNAM_ALL);
      expect(areaIds).toContain(GIMHAE);

      // 라벨은 표시 증거이지 조인 키가 아니다. 그래도 관측된 이름이 그대로 실린다.
      const province = matched.find((auction) =>
        auction.eligibilityAreas!.some((area) => area.codeValueId === GYEONGNAM_ALL));
      expect(province?.eligibilityAreas?.[0]?.label).toBe("경남/전체");
      expect(province?.eligibilityAreas?.[0]?.scheme).toBe("eat:eligibility-area");
    });
    await expectOwnedContainersCleanedUp();
  }, 180_000);

  test("도 전체를 뺀 설정은 김해로 못 박은 둘만 보고 질의가 코드를 스스로 넓히지 않는다", async () => {
    await withDatabase(async ({ api }) => {
      const reader = new DrizzleOpenAuctionReader(drizzle({ client: api }));

      // 선택 시점의 입력 보조가 켜 준 `경남/전체`를 사용자가 일부러 뺀 상태다. 질의가 계층을 다시 타면
      // 뺀 선택이 되살아나 화면이 보여 준 선택과 결과가 어긋난다.
      const gimhaeOnly = pageOf(await reader.listOpen({
        ...baseQuery,
        eligibilityAreaCodeValueIds: [GIMHAE],
      }));
      expect(gimhaeOnly.eligibilityMatchedCount).toBe(2);
      expect(gimhaeOnly.eligibilityUnobservedCount).toBe(7);

      // 고른 지역이 하나도 없는 확인은 필터 없음과 다르다. 매칭 0건에 미관측만 남는다.
      const none = pageOf(await reader.listOpen({ ...baseQuery, eligibilityAreaCodeValueIds: [] }));
      expect(none.eligibilityMatchedCount).toBe(0);
      expect(none.sampleCount).toBe(7);

      // 다른 시도의 코드는 경남 공고를 잡지 않는다.
      const other = pageOf(await reader.listOpen({
        ...baseQuery,
        eligibilityAreaCodeValueIds: [GYEONGBUK_ALL],
      }));
      expect(other.eligibilityMatchedCount).toBe(0);
    });
    await expectOwnedContainersCleanedUp();
  }, 180_000);

  test("100건이 넘는 목록도 keyset 페이지 상한 안에서 같은 표본 수를 유지한다", async () => {
    await withDatabase(async ({ api }) => {
      const reader = new DrizzleOpenAuctionReader(drizzle({ client: api }));
      const first = pageOf(await reader.listOpen({
        ...baseQuery,
        eligibilityAreaCodeValueIds: [GIMHAE, GYEONGNAM_ALL],
        limit: 5,
      }));
      expect(first.auctions).toHaveLength(5);
      // 표본 수는 cursor와 무관하다. 페이지를 넘겨도 화면 위 숫자가 흔들리지 않는다.
      expect(first.sampleCount).toBe(16);
      expect(first.nextCursor).not.toBeNull();

      const second = pageOf(await reader.listOpen({
        ...baseQuery,
        eligibilityAreaCodeValueIds: [GIMHAE, GYEONGNAM_ALL],
        limit: 5,
        cursor: first.nextCursor,
      }));
      expect(second.sampleCount).toBe(16);
      const overlap = second.auctions.filter((row) =>
        first.auctions.some((earlier) => earlier.auctionAttemptId === row.auctionAttemptId));
      expect(overlap).toHaveLength(0);
    });
    await expectOwnedContainersCleanedUp();
  }, 180_000);
});

describe("참가제한지역 목록과 저장 전 미리보기 PostgreSQL 경계", () => {
  test("선택 목록이 시도 묶음으로 접히고 `전체` 코드가 그 묶음의 머리로 온다", async () => {
    await withDatabase(async ({ api }) => {
      const reader = new DrizzleEligibilityAreaReader(drizzle({ client: api }));
      const catalog = await reader.listAreas();

      expect(catalog.scheme).toBe("eat:eligibility-area");
      const gyeongnam = catalog.groups.find((group) => group.all.codeValueId === GYEONGNAM_ALL);
      expect(gyeongnam?.all.label).toBe("경남/전체");
      expect(gyeongnam?.parts.map((part) => part.codeValueId).sort()).toEqual([GIMHAE, CHANGWON].sort());
      // 시군구가 관측되지 않은 시도도 묶음으로 남는다 — 그 코드로 제한된 공고를 고를 수 있어야 한다.
      const gyeongbuk = catalog.groups.find((group) => group.all.codeValueId === GYEONGBUK_ALL);
      expect(gyeongbuk?.parts).toEqual([]);
      // 라벨이 관측되지 않은 코드를 감추지 않고 그 수를 센다.
      expect(catalog.unlabeledAreaCount).toBe(1);
      expect(catalog.areaCount).toBe(4);
    });
    await expectOwnedContainersCleanedUp();
  }, 180_000);

  test("미리보기가 오늘 세 숫자와 몰리는 날 최대를 실제 조회로 낸다", async () => {
    await withDatabase(async ({ api }) => {
      const reader = new DrizzleEligibilityAreaReader(drizzle({ client: api }));
      const preview = new PreviewRegionCoverage(reader, fixedClock(NOW));
      const { coverage, query } = await Effect.runPromise(
        preview.execute({ codeValueIds: [GIMHAE, GYEONGNAM_ALL] }),
      );

      expect(coverage.today).toEqual({ matchedCount: 9, unobservedCount: 7, nationwideCount: 17 });
      // 오늘 건수만 보면 이 제품이 쓸모없어 보인다. 성수기 하루가 같은 응답에 함께 있어야 한다.
      expect(coverage.window.peakDay).toEqual({ date: PEAK_DATE, count: PEAK_COUNT });
      expect(coverage.window.daysWithAuctions).toBe(DAYS_WITH_AUCTIONS);
      expect(coverage.window.medianDayCount).toBe(MEDIAN_DAY_COUNT);
      // 창의 양끝은 주입된 clock이 정하고 응답이 그대로 싣는다(AGENTS 7·17).
      expect(query.asOf.toString()).toBe(REGION_FILTER_NOW);
      expect(query.windowStart.toString()).toBe("2026-06-09T01:00:00Z");
      expect(coverage.snapshotLineage?.calcVersion).toBe("mart-r3");
    });
    await expectOwnedContainersCleanedUp();
  }, 180_000);
});

describe("워크스페이스 관심 지역 저장 경계", () => {
  test("저장한 목록을 그대로 읽고 다른 워크스페이스는 읽지도 쓰지도 못한다", async () => {
    await withDatabase(async ({ api }) => {
      const database = drizzle({ client: api }) as unknown as AccountDatabase;
      const accounts = new DrizzleAccountRepository(database);
      const preferences = new DrizzleRegionPreferenceRepository(database);
      const mine = await accounts.initializeAccount({ subject: "owner", workspaceName: "내 워크스페이스" });
      const rival = await accounts.initializeAccount({ subject: "stranger", workspaceName: "남의 워크스페이스" });

      // 미설정은 오류가 아니라 유효한 상태다. 판정은 "값이 있나"가 아니라 "확인했나"다.
      expect(await preferences.readPreference(mine.workspace.workspaceId))
        .toEqual({ areas: [], confirmedAt: null });

      const saved = await preferences.replacePreference({
        workspaceId: mine.workspace.workspaceId,
        principalId: mine.principalId,
        codeValueIds: [GIMHAE, GYEONGNAM_ALL],
      });
      if (saved.kind !== "replaced") throw new Error("저장이 성공해야 합니다");
      expect(saved.preference.areas.map((area) => area.codeValueId)).toEqual([GYEONGNAM_ALL, GIMHAE]);
      expect(saved.preference.confirmedAt).not.toBeNull();

      // 도 전체를 뺀 상태도 그대로 저장된다.
      const trimmed = await preferences.replacePreference({
        workspaceId: mine.workspace.workspaceId,
        principalId: mine.principalId,
        codeValueIds: [GIMHAE],
      });
      if (trimmed.kind !== "replaced") throw new Error("교체가 성공해야 합니다");
      expect(trimmed.preference.areas.map((area) => area.codeValueId)).toEqual([GIMHAE]);

      // 코드를 하나도 고르지 않고 확인만 한 상태는 미설정과 다르다.
      const empty = await preferences.replacePreference({
        workspaceId: mine.workspace.workspaceId,
        principalId: mine.principalId,
        codeValueIds: [],
      });
      if (empty.kind !== "replaced") throw new Error("빈 선택도 저장돼야 합니다");
      expect(empty.preference.areas).toEqual([]);
      expect(empty.preference.confirmedAt).not.toBeNull();

      // 남의 워크스페이스는 내 저장을 보지 못한다.
      expect(await preferences.readPreference(rival.workspace.workspaceId))
        .toEqual({ areas: [], confirmedAt: null });
    });
    await expectOwnedContainersCleanedUp();
  }, 180_000);

  test("참가제한지역 체계에 없는 코드는 아무것도 바꾸지 않고 거절한다", async () => {
    await withDatabase(async ({ api }) => {
      const database = drizzle({ client: api }) as unknown as AccountDatabase;
      const accounts = new DrizzleAccountRepository(database);
      const preferences = new DrizzleRegionPreferenceRepository(database);
      const mine = await accounts.initializeAccount({ subject: "owner", workspaceName: "내 워크스페이스" });

      await preferences.replacePreference({
        workspaceId: mine.workspace.workspaceId,
        principalId: mine.principalId,
        codeValueIds: [GIMHAE],
      });
      const rejected = await preferences.replacePreference({
        workspaceId: mine.workspace.workspaceId,
        principalId: mine.principalId,
        codeValueIds: [GIMHAE, 9_223_372_036_854_775_807n],
      });
      expect(rejected.kind).toBe("unknown-area");
      // 아는 코드만 골라 저장하면 화면이 보여 준 선택과 저장된 선택이 조용히 달라진다.
      expect((await preferences.readPreference(mine.workspace.workspaceId)).areas.map((area) => area.codeValueId))
        .toEqual([GIMHAE]);
    });
    await expectOwnedContainersCleanedUp();
  }, 180_000);
});
