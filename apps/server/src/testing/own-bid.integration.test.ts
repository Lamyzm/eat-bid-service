// docker PostgreSQL이 필요한 통합 테스트이며 `database.integration.test.ts`와 같은 harness·관행을 따른다.
import { describe, expect, test } from "bun:test";
import type { SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { DrizzleOwnBidReader } from "../modules/procurement/infrastructure/drizzle/drizzle-own-bid-reader";
import type { OwnBidAttemptRecord, OwnBidListing } from "../modules/procurement/application/own-bid-reader";
import { organizationId } from "../modules/procurement/domain/organization-id";
import { createUnitOfWork } from "../platform/database/unit-of-work";
import {
  ACTIVE_BUILD_ID,
  BULK_ATTEMPT_COUNT,
  MY_SUPPLIER_PARTY_ID,
  NEXT_BUILD_ID,
  OBSERVED_AT,
  OTHER_ORGANIZATION_ID,
  OVERSIZED_ROSTER_ROWS,
  TARGET_ORGANIZATION_ID,
  bulkAttemptKeys,
  ownBidDatabase,
  publishNextBuild,
} from "../../fixtures/own-bid.fixture";

const key = (attemptId: bigint, revisionId: bigint) => ({ attemptId, revisionId });
const observedAttempts = [
  key(8101n, 9101n), key(8102n, 9102n), key(8103n, 9103n),
  key(8104n, 9104n), key(8105n, 9105n), key(8107n, 9107n),
  key(8108n, 9108n), key(8109n, 9109n),
];

function resultOf(listing: OwnBidListing, attemptId: bigint): OwnBidAttemptRecord["result"] {
  if (listing.kind !== "observations") throw new Error(`목록이 관측이 아닙니다: ${listing.kind}`);
  const record = listing.attempts.find((attempt) => attempt.attemptId === attemptId);
  if (!record) throw new Error(`회차 ${attemptId.toString(10)}가 응답에 없습니다`);
  return record.result;
}

describe("실제 API 역할의 내 투찰 관측 batch 조회", () => {
  test("고정 revision의 명단에서 여러 원본 계정의 제출을 모두 보존하고 상태를 이름으로 나눈다", async () => {
    await ownBidDatabase.withDatabase(async ({ api }) => {
      const database = drizzle({ client: api });
      const snapshot = createUnitOfWork({
        transaction: (work) => database.transaction(
          (transaction) => work(transaction),
          { isolationLevel: "repeatable read", accessMode: "read only" },
        ),
      });
      const reader = new DrizzleOwnBidReader();

      const listing = await snapshot.run((handle) => reader.read(handle, {
        supplierPartyId: MY_SUPPLIER_PARTY_ID,
        organizationId: organizationId(TARGET_ORGANIZATION_ID),
        buildId: ACTIVE_BUILD_ID,
        attempts: observedAttempts,
      }));
      expect(listing.kind).toBe("observations");
      if (listing.kind !== "observations") return;
      // 요청 순서를 그대로 돌려준다. 소비자가 좌표로 다시 맞추지 않아도 된다.
      expect(listing.attempts.map((attempt) => attempt.attemptId)).toEqual(observedAttempts.map((item) => item.attemptId));
      expect(listing.lineage.buildId).toBe(ACTIVE_BUILD_ID);

      const submitted = resultOf(listing, 8101n);
      expect(submitted.kind).toBe("submitted");
      if (submitted.kind !== "submitted") return;
      // 낙찰 판정이 없는 회차이고, 같은 party가 서로 다른 원본 계정으로 낸 두 제출이 모두 남는다.
      expect(submitted.rows).toHaveLength(2);
      expect(submitted.rows.map((row) => row.sourceSupplierAccountId)).toEqual([7801n, 7803n]);
      expect(submitted.rows.map((row) => row.rosterOrdinal)).toEqual([1, 2]);
      expect(submitted.rosterRowCount).toBe(3);
      expect(submitted.observedAt.toString()).toBe(OBSERVED_AT.attempt8101);
      expect(submitted.provenance.contentSha256).toBe("d".repeat(64));
      // 실제 금액 미관측은 null이고 계산 금액의 자리표시자를 제출 금액으로 승격하지 않는다(ADR 0041 §2).
      expect(submitted.rows[0]?.submittedAmount).toBeNull();
      expect(submitted.rows[0]?.sourceCalculatedAmount).toMatchObject({ amount: "10000000043768.00", currency: "KRW" });
      // 예정가격을 넘는 투찰의 사정률은 100을 넘는 관측 그대로다(ADR 0040).
      expect(submitted.rows[0]?.bidRate).toBe("101.975");
      expect(submitted.rows[0]?.rank).toBeNull();
      expect(submitted.rows[1]?.submittedAmount).toMatchObject({ amount: "43120180.00" });
      expect(submitted.rows[1]?.sourceStatus).toMatchObject({ code: "005", scheme: "eat:bid-status", label: "낙찰실패" });

      // 명단은 관측됐고 내 행만 없다. 명단 자체가 없는 회차와 다른 사실이다.
      expect(resultOf(listing, 8102n)).toMatchObject({ kind: "absent-from-roster", rosterRowCount: 2 });
      expect(resultOf(listing, 8103n).kind).toBe("roster-not-observed");
      expect(resultOf(listing, 8104n)).toEqual({ kind: "evidence-conflict", reason: "roster-count-mismatch" });
      expect(resultOf(listing, 8105n)).toEqual({ kind: "evidence-conflict", reason: "observation-time-conflict" });
      // 상한을 넘긴 회차는 그 회차만 격리된다. 같은 요청의 다른 회차는 위에서 정상으로 읽혔다.
      expect(resultOf(listing, 8107n)).toEqual({ kind: "evidence-conflict", reason: "roster-count-mismatch" });
      expect(OVERSIZED_ROSTER_ROWS).toBeGreaterThan(2048);
    });
    await ownBidDatabase.expectOwnedContainersCleanedUp();
  }, 300_000);

  test("명단 행이 다른 관측을 가리키면 내 행 여부와 무관하게 그 회차만 격리한다", async () => {
    await ownBidDatabase.withDatabase(async ({ api }) => {
      const database = drizzle({ client: api });
      const snapshot = createUnitOfWork({
        transaction: (work) => database.transaction(
          (transaction) => work(transaction),
          { isolationLevel: "repeatable read", accessMode: "read only" },
        ),
      });
      const reader = new DrizzleOwnBidReader();

      // 두 회차 모두 명단 수·좌표·회차 좌표·개찰 시각·관측 시각이 정상이다. 어긋난 것은 제출 행
      // 하나의 observation_id뿐이며, 그 행은 실재하는 다른 관측을 가리킨다.
      const mine = MY_SUPPLIER_PARTY_ID.toString(10);
      expect(await api`
        select bs.auction_revision_id::text as revision_id, bs.roster_ordinal,
               bs.supplier_party_id::text as party_id,
               (bs.observation_id = ar.observation_id) as same_observation
          from core.bid_submission bs
          join core.auction_revision ar on ar.auction_revision_id = bs.auction_revision_id
         where bs.auction_revision_id in (9108, 9109)
         order by bs.auction_revision_id, bs.roster_ordinal
      `).toEqual([
        { revision_id: "9108", roster_ordinal: 0, party_id: "7702", same_observation: true },
        { revision_id: "9108", roster_ordinal: 1, party_id: mine, same_observation: false },
        { revision_id: "9109", roster_ordinal: 0, party_id: "7702", same_observation: false },
        { revision_id: "9109", roster_ordinal: 1, party_id: mine, same_observation: true },
      ]);

      const listing = await snapshot.run((handle) => reader.read(handle, {
        supplierPartyId: MY_SUPPLIER_PARTY_ID,
        organizationId: organizationId(TARGET_ORGANIZATION_ID),
        buildId: ACTIVE_BUILD_ID,
        attempts: [key(8108n, 9108n), key(8109n, 9109n), key(8101n, 9101n), key(8102n, 9102n)],
      }));
      // 내 행이 어긋난 회차를 제출로 포장하지 않는다.
      expect(resultOf(listing, 8108n)).toEqual({ kind: "evidence-conflict", reason: "roster-observation-mismatch" });
      // 내 행은 멀쩡하고 남의 행만 어긋난 회차도 같다. 내 party 행만 검사하면 여기서 통과한다.
      expect(resultOf(listing, 8109n)).toEqual({ kind: "evidence-conflict", reason: "roster-observation-mismatch" });
      // 같은 요청의 정상 회차는 그대로 남는다. 한 회차의 격리가 나머지를 비우지 않는다.
      expect(resultOf(listing, 8101n).kind).toBe("submitted");
      expect(resultOf(listing, 8102n).kind).toBe("absent-from-roster");
    });
    await ownBidDatabase.expectOwnedContainersCleanedUp();
  }, 300_000);

  test("mart가 고정한 revision을 읽고 더 새로운 core 해석으로 바꿔 읽지 않는다", async () => {
    await ownBidDatabase.withDatabase(async ({ api }) => {
      const database = drizzle({ client: api });
      const snapshot = createUnitOfWork({
        transaction: (work) => database.transaction(
          (transaction) => work(transaction),
          { isolationLevel: "repeatable read", accessMode: "read only" },
        ),
      });
      const reader = new DrizzleOwnBidReader();
      const read = (attempts: ReadonlyArray<{ attemptId: bigint; revisionId: bigint }>) =>
        snapshot.run((handle) => reader.read(handle, {
          supplierPartyId: MY_SUPPLIER_PARTY_ID,
          organizationId: organizationId(TARGET_ORGANIZATION_ID),
          buildId: ACTIVE_BUILD_ID,
          attempts,
        }));

      // 9111은 같은 회차의 더 새로운 해석이고 그 명단에는 내 행이 없다. mart 고정 revision을 읽어야
      // 내 제출 두 건이 남는다.
      const pinned = await read([key(8101n, 9101n)]);
      expect(resultOf(pinned, 8101n).kind).toBe("submitted");
      // 그 새 해석을 직접 요청하면 이 build의 요약에 없으므로 조용히 대신 읽지 않는다.
      expect((await read([key(8101n, 9111n)])).kind).toBe("attempts-not-in-build");
      // 다른 기관의 회차도 마찬가지다. 기관을 넘겨 읽는 경로를 만들지 않는다.
      expect((await read([key(8106n, 9106n)])).kind).toBe("attempts-not-in-build");
      expect(OTHER_ORGANIZATION_ID).toBe(43n);
    });
    await ownBidDatabase.expectOwnedContainersCleanedUp();
  }, 300_000);

  test("60회차를 물어도 왕복 수가 회차 수를 따라가지 않고 build 전환은 재조회 신호가 된다", async () => {
    await ownBidDatabase.withDatabase(async ({ api, owner }) => {
      const database = drizzle({ client: api });
      let executed = 0;
      const snapshot = createUnitOfWork({
        transaction: (work) => database.transaction(
          (transaction) => work({
            execute: (query: SQL) => {
              executed += 1;
              return transaction.execute(query);
            },
          }),
          { isolationLevel: "repeatable read", accessMode: "read only" },
        ),
      });
      const reader = new DrizzleOwnBidReader();
      const read = (attempts: ReadonlyArray<{ attemptId: bigint; revisionId: bigint }>, buildId: bigint) =>
        snapshot.run((handle) => reader.read(handle, {
          supplierPartyId: MY_SUPPLIER_PARTY_ID,
          organizationId: organizationId(TARGET_ORGANIZATION_ID),
          buildId,
          attempts,
        }));

      const single = await read([key(8103n, 9103n)], ACTIVE_BUILD_ID);
      const singleRoundTrips = executed;
      executed = 0;
      const bulk = await read(bulkAttemptKeys, ACTIVE_BUILD_ID);
      expect(bulk.kind).toBe("observations");
      if (bulk.kind === "observations") expect(bulk.attempts).toHaveLength(BULK_ATTEMPT_COUNT);
      expect(single.kind).toBe("observations");
      // 회차마다 명단을 다시 물으면 여기서 60이 된다. 왕복 수는 회차 수와 무관해야 한다.
      expect(executed).toBe(singleRoundTrips);

      // mart 발행은 dataplane 역할이 하는 쓰기이므로 API 연결이 아니라 owner로 재현한다.
      await publishNextBuild(owner);
      const afterPublish = await read([key(8101n, 9101n)], ACTIVE_BUILD_ID);
      // 고정한 build가 사라졌다. 새 build에서 조용히 읽으면 표와 점이 다른 계보를 말하게 된다.
      expect(afterPublish).toEqual({ kind: "build-changed", activeBuildId: NEXT_BUILD_ID });
    });
    await ownBidDatabase.expectOwnedContainersCleanedUp();
  }, 300_000);
});
