// docker PostgreSQL이 필요한 통합 테스트다. `own-bid.fixture.ts`의 명단 사슬(build 601) 위에 공고지역 코드와 예정가격만 얹는다.
// 여기서만 확인되는 것은 SQL이다 — 개찰 시각으로 나뉜 명단 표를 회차의 개찰 시각으로 거르는 조인, 업체마다 가장 낮은 값 하나로
// 세우는 사다리, 하한 미만·자리표시자 값 거르기, 그리고 API 역할 권한으로 core 명단과 라벨을 읽을 수 있는지다.
import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import type postgres from "postgres";

import type { FloorLineWindow } from "../modules/procurement/application/floor-line-reader";
import { kstDate, kstDayAfter, kstDayStart } from "../modules/procurement/domain/kst-day";
import { DrizzleFloorLineReader } from "../modules/procurement/infrastructure/drizzle/drizzle-floor-line-reader";
import { disposableDatabase } from "../../fixtures/disposable-database.fixture";
import { seedOwnBid } from "../../fixtures/own-bid.fixture";

const SIDO = 4801n;
const SIGUNGU = 4802n;
const OTHER_SIGUNGU = 4803n;

/**
 * 8101(명단 셋)과 8102(명단 둘)를 같은 시군구에, 8106을 다른 시군구에 둔다. 기초금액 1,000,000원·예정가격 990,000원이라
 * 하한선은 기초금액의 89.1000%다. 8101 명단에서 하한(90.000) 위는 101.975 하나뿐이고, 8102는 모두 하한 아래다.
 */
async function placeRegions(owner: ReturnType<typeof postgres>): Promise<void> {
  await owner.unsafe(`
    insert into core.code_scheme (code_scheme_id, namespace, owner, version_policy, valid_time_policy)
    overriding system value
    values (4800, 'eat:auction-location-sido', 'eat', 'immutable', 'open'),
           (4810, 'eat:auction-location-sigungu', 'eat', 'immutable', 'open');
    insert into core.code_value (code_value_id, code_scheme_id, code)
    overriding system value values (${SIDO}, 4800, '48'), (${SIGUNGU}, 4810, '48250'), (${OTHER_SIGUNGU}, 4810, '48120');
    insert into core.code_label_observation (code_value_id, label, language, observed_at, observation_id)
    values (${SIDO}, '가상도', 'und', '2026-09-05T00:00:00Z', 6101),
           (${SIGUNGU}, '옛 이름', 'und', '2026-09-01T00:00:00Z', 6101),
           (${SIGUNGU}, '가상시', 'und', '2026-09-05T00:00:00Z', 6101);
    update mart.org_round_summary
       set opened_at = case auction_attempt_id when 8101 then '2026-09-05T05:00:00Z'::timestamptz
                                               when 8102 then '2026-09-06T05:00:00Z'::timestamptz
                                               else '2026-09-10T05:00:00Z'::timestamptz end,
           base_amount = 1000000.00, planned_amount = 990000.00,
           region_sido_code_value_id = ${SIDO},
           region_sigungu_code_value_id = case when auction_attempt_id = 8106 then ${OTHER_SIGUNGU} else ${SIGUNGU} end
     where build_id = 601 and auction_attempt_id in (8101, 8102, 8106);
  `);
}

const floorLineDatabase = disposableDatabase({
  task: "eat354-floor-lines",
  migrationApplyCount: 1,
  seed: (owner) => seedOwnBid(owner, { beforeActivation: placeRegions }),
});

const window: FloorLineWindow = {
  from: kstDayStart(kstDate("2026-09-01")),
  before: kstDayAfter(kstDate("2026-09-30")),
  floorRateMilli: 90_000n,
};

describe("하한선 자리 PostgreSQL 조회", () => {
  test("API 역할로 시군구 하나의 하한선 점과 1~10등 사다리, 지역 목록을 읽는다", async () => {
    await floorLineDatabase.withDatabase(async ({ api }) => {
      const reader = new DrizzleFloorLineReader(drizzle({ client: api }));

      const points = await reader.readPoints(window, SIGUNGU);
      // 예정가격이 있는 8101·8102만 점이다. 다른 시군구(8106)와 예정가격 없는 회차는 빠진다.
      expect(points.map((point) => point.attemptId)).toEqual([8101n, 8102n]);
      expect(points[0]!.floor).toBe("89.1000");
      expect(points[0]!.baseAmount).toEqual({ amount: "1000000.00", currency: "KRW" });
      expect(points[0]!.openedAt.toString()).toBe("2026-09-05T05:00:00Z");
      expect(points[0]!.organizationName).toBe("남산초");

      const ladders = await reader.readLadders(window, SIGUNGU);
      // 8101: 7701은 89.001(하한 아래)과 101.975를 냈고 하한 위 최저 하나만 센다. 7702의 89.002는 하한 아래다.
      // 101.975 × 990,000 ÷ 1,000,000 = 100.95525 → 소수 넷째 자리 반올림 100.9553.
      // 8102는 하한 위 투찰이 없어 사다리가 없다. 새 해석(9111)의 명단은 mart가 고정한 revision이 아니라 읽지 않는다.
      expect(ladders).toEqual([{ attemptId: 8101n, validBidderCount: 1, lowest: ["100.9553"] }]);

      const regions = await reader.readRegions(window);
      const mine = regions.find((region) => region.sigunguCodeValueId === SIGUNGU);
      // 라벨은 가장 나중 관측이다.
      expect(mine).toEqual({ sidoCodeValueId: SIDO, sidoLabel: "가상도", sigunguCodeValueId: SIGUNGU, sigunguLabel: "가상시", pointCount: 2 });
      expect(regions.find((region) => region.sigunguCodeValueId === OTHER_SIGUNGU)?.pointCount).toBe(1);

      expect(await reader.regionLabel(SIGUNGU)).toBe("가상시");
      expect((await reader.activeLineage())?.buildId).toBe(601n);
    });
  }, 240_000);

  test("하한율이 다르거나 기간 밖이면 점이 없다", async () => {
    await floorLineDatabase.withDatabase(async ({ api }) => {
      const reader = new DrizzleFloorLineReader(drizzle({ client: api }));
      expect(await reader.readPoints({ ...window, floorRateMilli: 88_000n }, SIGUNGU)).toEqual([]);
      // KST 9월 6일 하루만 보면 8102 하나다. 끝은 다음 날 0시 미만이다.
      const oneDay = { ...window, from: kstDayStart(kstDate("2026-09-06")), before: kstDayAfter(kstDate("2026-09-06")) };
      expect((await reader.readPoints(oneDay, SIGUNGU)).map((point) => point.attemptId)).toEqual([8102n]);
    });
  }, 240_000);

  test("검사가 만든 container를 남기지 않는다", async () => {
    await floorLineDatabase.expectOwnedContainersCleanedUp();
  });
});
