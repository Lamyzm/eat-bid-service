// docker PostgreSQL이 필요한 통합 테스트이며 `organization-attempts.fixture.ts`의 build 501을 함께 쓴다.
// 공고 조회가 "최신 관측 반영 안 됨"을 ingest가 아니라 활성 build의 mart 행에서만 읽고, 지금 보여 주는 revision과
// build가 본 revision이 같을 때만 싣는지를 실제 질의로 닫는다(ADR 0061 결정 5, EAT-295).
import { expect, test } from "bun:test";
import { Temporal } from "@eatbid/domain";
import { drizzle } from "drizzle-orm/postgres-js";
import { withSeededDatabase } from "../../fixtures/organization-attempts.fixture";
import { auctionId } from "../modules/procurement/domain/auction-id";
import { DrizzleAuctionReader } from "../modules/procurement/infrastructure/drizzle/drizzle-auction-reader";

test("활성 build가 미반영으로 적은 공고만 두 관측 시각을 싣고 revision이 바뀐 행은 무시한다", async () => {
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
    await client.unsafe(`
  insert into mart.build_stale_auction
    (build_id, auction_attempt_id, auction_revision_id, excluded_observed_at, reflected_observed_at)
  values (501, 103, 207, '2026-09-03T06:00:00Z', '2026-09-03T00:00:30Z'),
         (501, 102, 211, '2026-09-03T06:00:00Z', '2026-09-03T00:00:30Z');
`);
  });
}, 180_000);
