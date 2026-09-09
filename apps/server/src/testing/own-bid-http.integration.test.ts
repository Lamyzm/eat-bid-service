// docker PostgreSQL이 필요한 통합 테스트이며 `account-http.integration.test.ts`와 같은 harness를 따른다.
import { describe, expect, test } from "bun:test";
import request from "supertest";
import { meV1Operations, myBidObservationV1Operations } from "@eatbid/contracts";
import { createApp } from "../bootstrap/create-app";
import { parseEnvironment } from "../platform/config/environment";
import { createTestAuth, signInThroughAdapter, testAuthSecret } from "../../fixtures/auth-session.fixture";
import {
  ACTIVE_BUILD_ID,
  MY_SUPPLIER_PARTY_ID,
  OBSERVED_AT,
  TARGET_ORGANIZATION_ID,
  conflictedBusinessNumber,
  myBusinessNumber,
  observeConflictingSupplier,
  ownBidDatabase,
  publishNextBuild,
  unobservedBusinessNumber,
} from "../../fixtures/own-bid.fixture";

const origin = "http://localhost:3000";
const initializePath = meV1Operations.initializeCurrentAccount.buildPath({ path: undefined });
const businessesPath = meV1Operations.listMyBusinesses.buildPath({ path: undefined });
const observationsPath = (businessId: string) =>
  myBidObservationV1Operations.findMyBidObservations.buildPath({ path: { businessId } });

const observedAttempts = [
  { attemptId: "8101", revisionId: "9101" },
  { attemptId: "8102", revisionId: "9102" },
  { attemptId: "8103", revisionId: "9103" },
];

function environmentFor(databaseUrl: string) {
  return parseEnvironment({
    NODE_ENV: "test",
    PORT: "0",
    CORS_ORIGINS: origin,
    DATABASE_URL: databaseUrl,
    BETTER_AUTH_SECRET: testAuthSecret,
    BETTER_AUTH_URL: origin,
    GOOGLE_CLIENT_ID: "test-client-id",
    GOOGLE_CLIENT_SECRET: "test-client-secret",
  });
}

function expectPrivateResponse(response: { headers: Record<string, string> }): void {
  // 개인 응답은 성공이든 실패든 공유 캐시에 남으면 안 된다. guard가 끊는 401·403에도 같은 헤더가 있어야 한다.
  expect(response.headers["cache-control"]).toBe("private, no-store");
  // Vary 토큰은 대소문자를 구분하지 않고, CORS가 먼저 붙인 `Origin`과 함께 온다(215ce0d).
  expect(response.headers["vary"].toLowerCase().split(",").map((token) => token.trim())).toContain("cookie");
}

describe("내 투찰 관측 HTTP 경계", () => {
  test("등록 사업자 소유자만 자기 기준의 실제 투찰을 받고 상태를 구분해 읽는다", async () => {
    await ownBidDatabase.withDatabase(async ({ api, apiUrl }) => {
      const { auth } = createTestAuth(api);
      const mine = await signInThroughAdapter(auth, { email: "own-bid-mine@example.com" });
      const stranger = await signInThroughAdapter(auth, { email: "own-bid-stranger@example.com" });
      const myCookie = mine.headers.get("cookie")!;
      const strangerCookie = stranger.headers.get("cookie")!;

      const runtime = await createApp({
        environment: environmentFor(apiUrl),
        logWriter: () => undefined,
        databaseReadiness: { isReady: () => Promise.resolve(true) },
      });
      const server = await runtime.listen(0, "127.0.0.1");
      try {
        await request(server).post(initializePath).set("cookie", myCookie).set("origin", origin);
        await request(server).post(initializePath).set("cookie", strangerCookie).set("origin", origin);
        const registered = await request(server).post(businessesPath)
          .set("cookie", myCookie).set("origin", origin)
          .send({ businessNumber: myBusinessNumber });
        expect(registered.status).toBe(201);
        const businessId: string = registered.body.business.businessId;
        expect(registered.body.business.supplier)
          .toEqual({ kind: "linked", supplierPartyId: MY_SUPPLIER_PARTY_ID.toString(10) });

        const command = {
          organizationId: TARGET_ORGANIZATION_ID.toString(10),
          buildId: ACTIVE_BUILD_ID.toString(10),
          attempts: observedAttempts,
        };
        const observed = await request(server).post(observationsPath(businessId))
          .set("cookie", myCookie).set("origin", origin).send(command);
        expect(observed.status).toBe(200);
        expectPrivateResponse(observed);
        expect(observed.body.supplier.kind).toBe("observed");
        expect(observed.body.supplier.supplierPartyId).toBe(MY_SUPPLIER_PARTY_ID.toString(10));
        expect(observed.body.meta.buildId).toBe(ACTIVE_BUILD_ID.toString(10));

        const [first, second, third] = observed.body.supplier.attempts;
        expect(first.revisionId).toBe("9101");
        expect(first.result.kind).toBe("submitted");
        expect(first.result.rows).toHaveLength(2);
        expect(first.result.observedAt).toBe(OBSERVED_AT.attempt8101);
        // 실제 금액 미관측과 100 초과 사정률이 wire까지 그대로 간다.
        expect(first.result.rows[0].submittedAmount).toBeNull();
        expect(first.result.rows[0].bidRate).toEqual({ value: "101.975", unit: "percentage-points" });
        expect(second.result.kind).toBe("absent-from-roster");
        expect(third.result.kind).toBe("roster-not-observed");
        // 명단이 미관측인 회차에는 세지 않은 행 수를 싣지 않는다.
        expect(third.result).not.toHaveProperty("rosterRowCount");

        // 남의 워크스페이스 등록으로는 같은 URL이 열리지 않는다.
        const byStranger = await request(server).post(observationsPath(businessId))
          .set("cookie", strangerCookie).set("origin", origin).send(command);
        expect(byStranger.status).toBe(403);
        expectPrivateResponse(byStranger);

        const anonymous = await request(server).post(observationsPath(businessId))
          .set("origin", origin).send(command);
        expect(anonymous.status).toBe(401);
        expectPrivateResponse(anonymous);

        const missing = await request(server).post(observationsPath("9223372036854775807"))
          .set("cookie", myCookie).set("origin", origin).send(command);
        expect(missing.status).toBe(404);
      } finally {
        await runtime.shutdown();
      }
    });
    await ownBidDatabase.expectOwnedContainersCleanedUp();
  }, 300_000);

  test("미연결·증거 불일치 사업자와 build 전환을 빈 목록으로 숨기지 않는다", async () => {
    await ownBidDatabase.withDatabase(async ({ api, apiUrl, owner }) => {
      const { auth } = createTestAuth(api);
      const session = await signInThroughAdapter(auth, { email: "own-bid-states@example.com" });
      const cookie = session.headers.get("cookie")!;

      const runtime = await createApp({
        environment: environmentFor(apiUrl),
        logWriter: () => undefined,
        databaseReadiness: { isReady: () => Promise.resolve(true) },
      });
      const server = await runtime.listen(0, "127.0.0.1");
      try {
        await request(server).post(initializePath).set("cookie", cookie).set("origin", origin);
        const register = (businessNumber: string) => request(server).post(businessesPath)
          .set("cookie", cookie).set("origin", origin).send({ businessNumber });
        const linked = await register(myBusinessNumber);
        const unobserved = await register(unobservedBusinessNumber);
        const conflicted = await register(conflictedBusinessNumber);
        expect(unobserved.body.business.supplier).toEqual({ kind: "unobserved" });
        expect(conflicted.status).toBe(201);
        // 등록 뒤에 원본이 같은 번호를 다른 표기로 다시 관측해 party가 둘이 됐다.
        await observeConflictingSupplier(owner);

        // 등록 하나의 증거가 갈렸다고 워크스페이스 목록 전체가 닫히지 않는다. 그 등록만 상태로 말한다.
        const listed = await request(server).get(businessesPath).set("cookie", cookie).set("origin", origin);
        expect(listed.status).toBe(200);
        expect(listed.body.businesses.map((business: { supplier: { kind: string } }) => business.supplier.kind))
          .toEqual(["linked", "unobserved", "evidence-conflict"]);

        const command = {
          organizationId: TARGET_ORGANIZATION_ID.toString(10),
          buildId: ACTIVE_BUILD_ID.toString(10),
          attempts: observedAttempts,
        };
        const ask = (businessId: string, body: unknown = command) => request(server)
          .post(observationsPath(businessId)).set("cookie", cookie).set("origin", origin).send(body);

        // 원본이 아직 관측하지 않은 번호는 회차 목록 자리 자체가 없다. 빈 배열은 미참여로 읽힌다.
        const unlinked = await ask(unobserved.body.business.businessId);
        expect(unlinked.status).toBe(200);
        expect(unlinked.body.supplier).toEqual({ kind: "unobserved" });

        // 한 번호가 두 party를 가리키면 하나를 고르지 않고 그 사실을 상태로 말한다.
        const ambiguous = await ask(conflicted.body.business.businessId);
        expect(ambiguous.status).toBe(200);
        expect(ambiguous.body.supplier).toEqual({ kind: "evidence-conflict" });

        // 이 build·이 기관의 요약에 없는 조합은 조용히 빼지 않고 요청 오류로 닫는다.
        const foreign = await ask(linked.body.business.businessId, {
          ...command,
          attempts: [{ attemptId: "8106", revisionId: "9106" }],
        });
        expect(foreign.status).toBe(400);
        const duplicated = await ask(linked.body.business.businessId, {
          ...command,
          attempts: [{ attemptId: "8101", revisionId: "9101" }, { attemptId: "8101", revisionId: "9111" }],
        });
        expect(duplicated.status).toBe(400);

        await publishNextBuild(owner);
        const stale = await ask(linked.body.business.businessId);
        expect(stale.status).toBe(409);
        expect(stale.body.code).toBe("CONFLICT");
        expectPrivateResponse(stale);
      } finally {
        await runtime.shutdown();
      }
    });
    await ownBidDatabase.expectOwnedContainersCleanedUp();
  }, 300_000);
});
