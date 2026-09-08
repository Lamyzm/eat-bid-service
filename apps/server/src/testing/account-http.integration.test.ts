import { describe, expect, test } from "bun:test";
import request from "supertest";
import { meV1Operations, sessionV1Operations } from "@eatbid/contracts";
import { createApp } from "../bootstrap/create-app";
import { parseEnvironment } from "../platform/config/environment";
import { withAccountDatabase } from "../../fixtures/account.fixture";
import {
  createTestAuth,
  signInThroughAdapter,
  sqlLiteral,
  testAuthSecret,
} from "../../fixtures/auth-session.fixture";

const origin = "http://localhost:3000";
const sessionPath = sessionV1Operations.getCurrentSession.buildPath({ path: undefined });
const initializePath = meV1Operations.initializeCurrentAccount.buildPath({ path: undefined });
const businessesPath = meV1Operations.listMyBusinesses.buildPath({ path: undefined });
const locationPath = (businessId: string) =>
  meV1Operations.setMyBusinessLocation.buildPath({ path: { businessId } });
const publishedBusinessNumber = "1248100998";

function environmentFor(databaseUrl: string, withAuth: boolean) {
  return parseEnvironment({
    NODE_ENV: "test",
    PORT: "0",
    CORS_ORIGINS: origin,
    DATABASE_URL: databaseUrl,
    ...(withAuth
      ? {
        BETTER_AUTH_SECRET: testAuthSecret,
        BETTER_AUTH_URL: origin,
        GOOGLE_CLIENT_ID: "test-client-id",
        GOOGLE_CLIENT_SECRET: "test-client-secret",
      }
      : {}),
  });
}

async function withServer<A>(
  databaseUrl: string,
  withAuth: boolean,
  work: (server: Awaited<ReturnType<Awaited<ReturnType<typeof createApp>>["listen"]>>) => Promise<A>,
): Promise<A> {
  const runtime = await createApp({
    environment: environmentFor(databaseUrl, withAuth),
    logWriter: () => undefined,
    databaseReadiness: { isReady: () => Promise.resolve(true) },
  });
  const server = await runtime.listen(0, "127.0.0.1");
  try {
    return await work(server);
  } finally {
    await runtime.shutdown();
  }
}

function expectPrivateResponse(response: { headers: Record<string, string> }): void {
  // 개인 응답은 성공이든 실패든 공유 캐시에 남으면 안 된다. guard가 끊는 401·403에도 같은 헤더가 있어야 한다.
  expect(response.headers["cache-control"]).toBe("private, no-store");
  const vary = (response.headers["vary"] ?? "").toLowerCase();
  expect(vary).toContain("cookie");
}

function expectVaryKeepsOrigin(response: { headers: Record<string, string> }): void {
  // CORS가 붙인 `Vary: Origin`을 덮어쓰면 origin마다 달라지는 응답이 공유 캐시에서 섞인다.
  const vary = (response.headers["vary"] ?? "").toLowerCase();
  expect(vary).toContain("origin");
  expect(vary).toContain("cookie");
}

describe("계정 HTTP 경계", () => {
  test("미로그인과 초기화 미완료를 다른 상태로 돌려주고 조회가 DB를 바꾸지 않는다", async () => {
    await withAccountDatabase(async ({ api, apiUrl, owner }) => {
      const { auth } = createTestAuth(api);
      const session = await signInThroughAdapter(auth, { email: "http-uninit@example.com" });

      await withServer(apiUrl, true, async (server) => {
        const anonymous = await request(server).get(sessionPath).set("origin", origin);
        expect(anonymous.status).toBe(200);
        expect(anonymous.body).toEqual({ state: "unauthenticated" });
        expectPrivateResponse(anonymous);
        expectVaryKeepsOrigin(anonymous);

        const before = await owner.unsafe(`select count(*)::int as total from app.principal`);
        const uninitialized = await request(server).get(sessionPath)
          .set("cookie", session.headers.get("cookie")!);
        expect(uninitialized.status).toBe(200);
        expect(uninitialized.body.state).toBe("uninitialized");
        expect(uninitialized.body.account.maskedEmail).toBe("h***@example.com");
        // 안전해야 할 GET이 계정을 만들면 둘러보기만 한 사용자에게도 빈 워크스페이스가 쌓인다.
        expect(await owner.unsafe(`select count(*)::int as total from app.principal`)).toEqual(before);

        const listed = await request(server).get(businessesPath)
          .set("cookie", session.headers.get("cookie")!);
        // 세션은 유효하지만 초기화가 끝나지 않았다. 재로그인이 답이 아니므로 401이 아니라 403이다.
        expect(listed.status).toBe(403);
        expectPrivateResponse(listed);
      });
    });
  }, 300_000);

  test("신뢰하지 않는 Origin의 상태 변경을 거부하고 허용된 Origin만 초기화한다", async () => {
    await withAccountDatabase(async ({ api, apiUrl }) => {
      const { auth } = createTestAuth(api);
      const session = await signInThroughAdapter(auth, { email: "http-origin@example.com" });
      const cookie = session.headers.get("cookie")!;

      await withServer(apiUrl, true, async (server) => {
        const missingOrigin = await request(server).post(initializePath).set("cookie", cookie);
        const foreignOrigin = await request(server).post(initializePath)
          .set("cookie", cookie).set("origin", "https://evil.example");
        expect(missingOrigin.status).toBe(403);
        expect(foreignOrigin.status).toBe(403);
        expectPrivateResponse(foreignOrigin);

        const initialized = await request(server).post(initializePath)
          .set("cookie", cookie).set("origin", origin);
        expect(initialized.status).toBe(200);
        expect(initialized.body.workspace.role).toBe("owner");

        const active = await request(server).get(sessionPath).set("cookie", cookie);
        expect(active.body.state).toBe("active");
        expect(active.body.principalId).toBe(initialized.body.principalId);
      });
    });
  }, 300_000);

  test("owner만 사업자를 등록하고 member는 403이며 중복은 409다", async () => {
    await withAccountDatabase(async ({ api, apiUrl, owner }) => {
      const { auth } = createTestAuth(api);
      const ownerSession = await signInThroughAdapter(auth, { email: "http-owner@example.com" });
      const memberSession = await signInThroughAdapter(auth, { email: "http-member@example.com" });
      const ownerCookie = ownerSession.headers.get("cookie")!;
      const memberCookie = memberSession.headers.get("cookie")!;

      await withServer(apiUrl, true, async (server) => {
        const initialized = await request(server).post(initializePath)
          .set("cookie", ownerCookie).set("origin", origin);
        await request(server).post(initializePath).set("cookie", memberCookie).set("origin", origin);
        const workspaceId = initialized.body.workspace.workspaceId;
        // 같은 워크스페이스의 member로 만든다. 화면에서 버튼만 감추면 클라이언트가 그대로 통과한다.
        await owner.unsafe(`
          insert into app.workspace_membership (workspace_id, principal_id, role)
          select ${sqlLiteral(workspaceId)}, principal_id, 'member'
          from app.identity_subject where subject = '${sqlLiteral(memberSession.userId)}';
          update app.principal_default_workspace
          set workspace_id = ${sqlLiteral(workspaceId)}
          where principal_id = (
            select principal_id from app.identity_subject where subject = '${sqlLiteral(memberSession.userId)}'
          );
        `);

        const registered = await request(server).post(businessesPath)
          .set("cookie", ownerCookie).set("origin", origin)
          .send({ businessNumber: "124-81-00998" });
        const duplicate = await request(server).post(businessesPath)
          .set("cookie", ownerCookie).set("origin", origin)
          .send({ businessNumber: publishedBusinessNumber });
        const byMember = await request(server).post(businessesPath)
          .set("cookie", memberCookie).set("origin", origin)
          .send({ businessNumber: "220-81-62517" });
        const malformed = await request(server).post(businessesPath)
          .set("cookie", ownerCookie).set("origin", origin)
          .send({ businessNumber: "124-81-00997" });

        expect(registered.status).toBe(201);
        // 사용자 표기를 canonical 숫자로 정규화해 저장한다.
        expect(registered.body.business.businessNumber).toBe(publishedBusinessNumber);
        expect(registered.body.business.supplier).toEqual({
          kind: "linked",
          supplierPartyId: "9007199254740995",
        });
        expect(duplicate.status).toBe(409);
        expect(byMember.status).toBe(403);
        // 검증번호 오류는 형식 실패이지 소유 실패가 아니다.
        expect(malformed.status).toBe(400);

        const memberList = await request(server).get(businessesPath).set("cookie", memberCookie);
        expect(memberList.status).toBe(200);
        expect(memberList.body.businesses).toHaveLength(1);
      });
    });
  }, 300_000);

  test("서로 다른 계정의 같은 URL 응답이 섞이지 않고 타 워크스페이스 등록은 403이다", async () => {
    await withAccountDatabase(async ({ api, apiUrl }) => {
      const { auth } = createTestAuth(api);
      const first = await signInThroughAdapter(auth, { email: "http-first@example.com" });
      const second = await signInThroughAdapter(auth, { email: "http-second@example.com" });
      const firstCookie = first.headers.get("cookie")!;
      const secondCookie = second.headers.get("cookie")!;

      await withServer(apiUrl, true, async (server) => {
        await request(server).post(initializePath).set("cookie", firstCookie).set("origin", origin);
        await request(server).post(initializePath).set("cookie", secondCookie).set("origin", origin);
        const mine = await request(server).post(businessesPath)
          .set("cookie", firstCookie).set("origin", origin)
          .send({ businessNumber: publishedBusinessNumber });
        const businessId = mine.body.business.businessId;

        const firstList = await request(server).get(businessesPath).set("cookie", firstCookie);
        const secondList = await request(server).get(businessesPath).set("cookie", secondCookie);
        expect(firstList.body.businesses).toHaveLength(1);
        expect(secondList.body.businesses).toEqual([]);
        expectPrivateResponse(firstList);

        const stranger = await request(server).put(locationPath(businessId))
          .set("cookie", secondCookie).set("origin", origin)
          .send({ addressText: "남의 사업장" });
        const missing = await request(server).put(locationPath("9223372036854775807"))
          .set("cookie", firstCookie).set("origin", origin)
          .send({ addressText: "없는 등록" });
        const saved = await request(server).put(locationPath(businessId))
          .set("cookie", firstCookie).set("origin", origin)
          .send({ addressText: "  서울특별시 중구 세종대로 110  " });
        const cleared = await request(server).delete(locationPath(businessId))
          .set("cookie", firstCookie).set("origin", origin);

        expect(stranger.status).toBe(403);
        expect(missing.status).toBe(404);
        expect(saved.status).toBe(200);
        expect(saved.body.business.location.addressText).toBe("서울특별시 중구 세종대로 110");
        expect(cleared.status).toBe(200);
        expect(cleared.body.business.location).toBeNull();
      });
    });
  }, 300_000);

  test("인증을 켜지 않은 배포는 세션 조회를 200 미로그인으로 위장하지 않는다", async () => {
    await withAccountDatabase(async ({ apiUrl }) => {
      await withServer(apiUrl, false, async (server) => {
        const response = await request(server).get(sessionPath);
        const provider = await request(server).get("/api/auth/get-session");

        expect(response.status).toBe(503);
        expect(response.body.code).toBe("DEPENDENCY_UNAVAILABLE");
        expectPrivateResponse(response);
        // 경로가 없는 것이 아니라 의존성이 없다. 404로 두면 배포 설정 누락이 오래 숨는다.
        expect(provider.status).toBe(503);
      });
    });
  }, 300_000);
});
