// docker PostgreSQL이 필요한 통합 테스트이며 `organization-attempts.integration.test.ts`와 같은 harness를 쓴다.
import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import { withSeededDatabase } from "../../fixtures/organization-attempts.fixture";
import {
  ACTIVE_LIST_COUNT,
  NEXT_LIST_COUNT,
  databaseWithPublishAfterFirstQuery,
  publishNextBuild,
  seedNextBuild,
  supersedeAllBuilds,
} from "../../fixtures/organization-attempt-build.fixture";
import type {
  OrganizationAttemptListing,
  OrganizationAttemptPage,
  OrganizationAttemptQuery,
} from "../modules/procurement/application/organization-attempt-reader";
import { organizationId } from "../modules/procurement/domain/organization-id";
import { DrizzleOrganizationAttemptReader } from "../modules/procurement/infrastructure/drizzle/drizzle-organization-attempt-reader";

// 개찰 기준을 두지 않아야 두 build의 회차 집합 차이가 개찰 필터에 가려지지 않는다.
const wholeHistory = {
  organizationId: organizationId(41n),
  itemCodeValueId: null,
  cursor: null,
  limit: 12,
  openedAtOrBefore: null,
} satisfies OrganizationAttemptQuery;

function pageOf(listing: OrganizationAttemptListing): OrganizationAttemptPage {
  if (listing.kind !== "page") throw new Error(`expected a page but got ${listing.kind}`);
  return listing.page;
}

describe("mart 발행 경합 아래 기관 회차 이력 build 정합성", () => {
  test("응답 도중 새 build가 활성화돼도 행·표본 수·다음 cursor·계보가 모두 처음 고른 build다", async () => {
    await withSeededDatabase(async ({ client }) => {
      const stable = drizzle({ client });

      // 발행 전 기준선이다. cursor는 요청한 기관과 같은 코호트만 가리켜야 한다.
      const beforePublish = new DrizzleOrganizationAttemptReader(stable);
      expect(await beforePublish.listAttempts({ ...wholeHistory, cursor: 104n }))
        .toEqual({ kind: "cursor-not-found", cursor: 104n });
      expect(await beforePublish.listAttempts({ ...wholeHistory, cursor: 102n, itemCodeValueId: 7n }))
        .toEqual({ kind: "cursor-not-found", cursor: 102n });

      // 첫 조회가 끝난 직후 501→502 발행이 완료된다. 남은 조회는 전부 502가 활성인 DB를 본다.
      const racing = new DrizzleOrganizationAttemptReader(
        databaseWithPublishAfterFirstQuery(stable, () => publishNextBuild(client)),
      );
      const raced = pageOf(await racing.listAttempts({ ...wholeHistory, limit: 3 }));
      expect(raced.attempts.map((attempt) => attempt.attemptId)).toEqual([105n, 103n, 102n]);
      // 502에는 없는 회차가 실렸다면 표본 수와 계보도 같은 501에서 와야 응답 하나가 한 사실을 말한다.
      expect(raced.sampleCount).toBe(4);
      expect(raced.nextCursor).toBe(102n);
      expect(raced.attempts[2]!.listCount).toBe(ACTIVE_LIST_COUNT);
      expect(raced.lineage).toMatchObject({
        buildId: 501n,
        sourceReleaseId: "00000000-0000-0000-0000-000000000141",
        calcVersion: "mart-r1",
        regionScheme: "eat:auction-location-sigungu",
        coverage: "unknown",
      });

      // 발행은 실제로 일어났다. 그 뒤의 새 요청은 502 하나만 보며 stale은 여기서 끝난다.
      const afterPublish = new DrizzleOrganizationAttemptReader(stable);
      const next = pageOf(await afterPublish.listAttempts(wholeHistory));
      expect(next.attempts.map((attempt) => attempt.attemptId)).toEqual([102n, 101n]);
      expect(next.sampleCount).toBe(2);
      expect(next.attempts[0]!.listCount).toBe(NEXT_LIST_COUNT);
      expect(next.lineage).toMatchObject({
        buildId: 502n,
        sourceReleaseId: "00000000-0000-0000-0000-000000000142",
        calcVersion: "mart-r2",
        regionScheme: "eat:auction-location-sido",
        coverage: "complete",
      });
      // 501에만 있던 회차의 cursor는 502에서 가리킬 행이 없다. 빈 페이지가 아니라 명시적 실패다.
      expect(await afterPublish.listAttempts({ ...wholeHistory, cursor: 103n }))
        .toEqual({ kind: "cursor-not-found", cursor: 103n });
    }, seedNextBuild);
  }, 180_000);

  test("cursor anchor를 확인한 뒤 발행돼도 같은 build를 이어 읽고 활성 build가 없으면 빈 이력이다", async () => {
    await withSeededDatabase(async ({ client }) => {
      const stable = drizzle({ client });

      // cursor가 있으면 anchor 조회가 먼저다. 그 조회 직후에 발행을 끼워 넣는다.
      const racing = new DrizzleOrganizationAttemptReader(
        databaseWithPublishAfterFirstQuery(stable, () => publishNextBuild(client)),
      );
      const raced = pageOf(await racing.listAttempts({ ...wholeHistory, cursor: 103n }));
      // 103은 501에만 있다. anchor를 찾은 build를 이어 읽지 않으면 이 요청은 이력 끝으로 위장한다.
      expect(raced.attempts.map((attempt) => attempt.attemptId)).toEqual([102n, 101n]);
      expect(raced.sampleCount).toBe(4);
      expect(raced.nextCursor).toBeNull();
      expect(raced.attempts[0]!.listCount).toBe(ACTIVE_LIST_COUNT);
      expect(raced.lineage).toMatchObject({ buildId: 501n, calcVersion: "mart-r1" });

      // 활성 build를 하나도 남기지 않는다. 파생물이 없는 상태는 오류가 아니라 빈 이력이다.
      await supersedeAllBuilds(client);
      const withoutBuild = new DrizzleOrganizationAttemptReader(stable);
      const empty = pageOf(await withoutBuild.listAttempts(wholeHistory));
      expect(empty.attempts).toEqual([]);
      expect(empty.sampleCount).toBe(0);
      expect(empty.nextCursor).toBeNull();
      expect(empty.lineage).toBeNull();
      // 읽을 build가 없으면 cursor가 가리킬 행도 없다. 빈 페이지로 뭉개지 않는다.
      expect(await withoutBuild.listAttempts({ ...wholeHistory, cursor: 102n }))
        .toEqual({ kind: "cursor-not-found", cursor: 102n });
    }, seedNextBuild);
  }, 180_000);
});
