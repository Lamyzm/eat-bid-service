/**
 * @module 책임: 내 투찰 E2E가 실제 migration DB·실제 Nest 조립·실제 서명 세션 위에서 돌도록 수명주기를 열고 닫고,
 * Playwright child에 세션 쿠키를 메모리로만 넘기며, build 전환을 시험 전용 제어 포트로 제공한다.
 *
 * auth-e2e.ts와 같은 이유로 Bun이 apps/server cwd에서 실행한다(Nest DI가 server tsconfig의 decorator
 * metadata를 요구한다). 제어 포트는 harness 프로세스 안의 loopback 하나이며 제품 endpoint가 아니다 —
 * 브라우저가 mart build 전환을 직접 일으킬 수 없으므로 소유자(DB owner)만 그 전환을 실행한다.
 */
import { expect } from 'bun:test';
import { auctionV1Operations } from '@eatbid/contracts/api/v1/auctions';
import { meV1Operations } from '@eatbid/contracts/api/v1/me';
import { organizationV1Operations } from '@eatbid/contracts/api/v1/organizations';
import { createApp } from '../../server/src/bootstrap/create-app';
import { parseEnvironment } from '../../server/src/platform/config/environment';
import {
  WEB_CURRENT_AUCTION_ID,
  withOwnBidWebDatabase,
  type OwnerClient
} from '../../server/fixtures/own-bid-web.fixture';
import {
  TARGET_ORGANIZATION_ID,
  conflictedBusinessNumber,
  myBusinessNumber,
  observeConflictingSupplier,
  publishNextBuild,
  unobservedBusinessNumber
} from '../../server/fixtures/own-bid.fixture';
import {
  createTestAuth,
  signInThroughAdapter,
  testAuthSecret
} from '../../server/fixtures/auth-session.fixture';

const WEB_ORIGIN = 'http://127.0.0.1:3147';
const API_ORIGIN = 'http://127.0.0.1:4447';
const API_PORT = 4447;
const webDirectory = new URL('..', import.meta.url);
/** `own-bid.fixture.ts`의 martSeed가 이미 만든 release다. 새 mart는 martName만 다르므로 그대로 재사용한다. */
const EXISTING_SOURCE_RELEASE_ID = '00000000-0000-0000-0000-000000000401';
/** `own-bid.fixture.ts`가 쓰는 601·602와 겹치지 않는, 이 스크립트 전용 build id다. */
const OPEN_AUCTION_SNAPSHOT_BUILD_ID = 701n;

function cookieValue(headers: Headers): string {
  const cookie = headers.get('cookie');
  if (!cookie) throw new Error('서명된 세션 쿠키가 필요합니다.');
  return cookie;
}

/**
 * `own-bid.fixture.ts`의 base seed는 회차 이력 화면만 채우고 `mart.open_auction_snapshot`에는 행을
 * 남기지 않는다(그 표는 `own-bid-web.fixture.ts`가 "mart에는 없다"고 명시한 WEB_CURRENT_AUCTION_ID의
 * 몫이 아니다). `/today`가 실제로 공고 행을 그리는지 진짜 Nest로 확인하려면 이 mart의 최소 build가
 * 있어야 하므로, `apps/server`를 건드리지 않고 이 owned e2e harness가 직접 만든다(EAT-165 acceptance:
 * "로그인한 사용자가 /today에서 공고 행을 본다").
 *
 * `mart.build`에는 `building`으로만 시작해 `verified`→`active` 순서로만 전환하라는 trigger가 있고
 * (`mart_build_transition`), mart 행 쓰기는 그 build가 `building`인 동안에만 허용된다
 * (`enforce_mart_row_build_is_building`). `own-bid.fixture.ts`의 `martActivationSeed`와 같은 순서를
 * 그대로 따른다. WEB_CURRENT_AUCTION_ID(8110)의 `core.auction_attempt`·`core.auction_revision`(9110)·
 * `ingest.raw_observation`(6120)은 `own-bid-web.fixture.ts`가 이미 만들어 뒀으므로 그대로 참조한다.
 */
async function seedOpenAuctionSnapshot(owner: OwnerClient): Promise<void> {
  const buildId = OPEN_AUCTION_SNAPSHOT_BUILD_ID;
  await owner.unsafe(`
    insert into mart.build
      (build_id, mart_name, source_release_id, calc_version, builder_version, status, as_of, started_at)
    overriding system value
    values (${buildId}, 'open_auction_snapshot', '${EXISTING_SOURCE_RELEASE_ID}', 'mart-r1',
      '${'a'.repeat(40)}', 'building', now(), now());
    insert into mart.open_auction_snapshot
      (build_id, auction_attempt_id, observed_at, observation_id, organization_id, bid_count,
       closes_at, opens_at, announced_at, base_amount, currency, item_label, terms_revision_id, organization_label)
    values (${buildId}, ${WEB_CURRENT_AUCTION_ID}, now(), 6120, ${TARGET_ORGANIZATION_ID}, 5,
      now() + interval '1 day', now() + interval '1 day 3 hours', now() - interval '1 day',
      2761700.00, 'KRW', '축산물', 9110, '창원 남산초등학교');
    update mart.build set status = 'verified', computed_at = now(), row_count = 1 where build_id = ${buildId};
    update mart.build set status = 'active', activated_at = now() where build_id = ${buildId};
  `);
  step(`오늘 화면용 open_auction_snapshot build ${buildId}를 활성화했다`);
}

function step(message: string): void {
  console.log(`[own-bid-e2e] ${message}`);
}

/**
 * Playwright 전에 seed가 화면의 전제를 실제로 만족하는지 본다. 공고 하나와 첫 페이지 60행·다음 페이지가 없으면
 * 브라우저 검사가 실패해도 seed 문제인지 화면 문제인지 가릴 수 없다.
 *
 * 두 조회 모두 `ProviderSessionGuard`가 걸려 있다(ADR 0032 §12). 쿠키 없이 부르면 seed 문제와 구분되지 않는
 * 401을 그대로 받으므로, 화면과 같은 조건을 재현하려고 로그인한 계정의 서명 세션 쿠키를 실어 보낸다(EAT-165).
 */
async function smoke(cookie: string): Promise<void> {
  const headers = { cookie };
  const auctionPath = auctionV1Operations.find.buildPath({ path: { auctionId: String(WEB_CURRENT_AUCTION_ID) } });
  const auction = await fetch(`${API_ORIGIN}${auctionPath}`, { headers });
  if (auction.status !== 200) throw new Error(`현재 공고 조회가 ${auction.status}입니다. seed를 확인하세요.`);
  const historyPath = organizationV1Operations.listAuctionAttempts.buildPath({
    path: { organizationId: String(TARGET_ORGANIZATION_ID) },
    query: { limit: 60, opened: 'only', includeRevision: 'true', floorRate: 'unknown', awardMethod: 'unknown' }
  });
  const history = await fetch(`${API_ORIGIN}${historyPath}`, { headers });
  const body = (await history.json()) as { attempts: { revisionId?: string }[]; nextCursor: string | null; meta: { buildId: string | null } };
  if (history.status !== 200 || body.attempts.length !== 60 || body.nextCursor === null || body.meta.buildId === null) {
    throw new Error(`회차 이력 smoke 실패: status ${history.status}, rows ${body.attempts?.length}, nextCursor ${body.nextCursor}`);
  }
  if (!body.attempts.every((attempt) => typeof attempt.revisionId === 'string')) {
    throw new Error('회차 이력이 includeRevision을 무시했습니다.');
  }
  step(`smoke 통과: 공고 ${WEB_CURRENT_AUCTION_ID}, 첫 페이지 60행, build ${body.meta.buildId}`);
}

/**
 * 첫째 계정의 등록은 harness가 실제 Nest 계약으로 한다. 증거가 갈린 번호는 등록 시점에 하나였어야 등록이
 * 성공하고 그 뒤에 갈릴 수 있으므로(ADR 0033 §1), 등록을 마친 뒤에 `observeConflictingSupplier`를 실행한다.
 * 쿠키는 이 프로세스 메모리의 요청 헤더로만 쓴다.
 */
async function registerFirstAccount(cookie: string): Promise<void> {
  const headers = { origin: WEB_ORIGIN, cookie, 'content-type': 'application/json' };
  const initialized = await fetch(`${API_ORIGIN}${meV1Operations.initializeCurrentAccount.buildPath({ path: undefined })}`, { method: 'POST', headers });
  if (initialized.status !== 200) throw new Error(`계정 초기화가 ${initialized.status}입니다: ${await initialized.text()}`);
  for (const businessNumber of [myBusinessNumber, unobservedBusinessNumber, conflictedBusinessNumber]) {
    const registered = await fetch(`${API_ORIGIN}${meV1Operations.registerMyBusiness.buildPath({ path: undefined })}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ businessNumber })
    });
    if (registered.status !== 201) throw new Error(`사업자 ${businessNumber} 등록이 ${registered.status}입니다: ${await registered.text()}`);
  }
  step('첫째 계정에 관측·미관측·충돌 예정 번호 세 개를 등록했다');
}

async function runPlaywright(env: Record<string, string>): Promise<number> {
  const child = Bun.spawn(
    ['pnpm', 'exec', 'playwright', 'test', '--config', 'playwright.own-bid.config.ts'],
    {
      cwd: Bun.fileURLToPath(webDirectory),
      stdio: ['inherit', 'inherit', 'inherit'],
      // 쿠키는 child 전용 환경으로만 건넨다. 명령 인자, 파일, 공개 helper endpoint에 남기지 않는다.
      env: { ...process.env, ...env }
    }
  );
  return await child.exited;
}

try {
  await withOwnBidWebDatabase(async ({ api, apiUrl, owner }) => {
    step('일회용 PostgreSQL 준비 완료');
    const { auth } = createTestAuth(api);
    const first = await signInThroughAdapter(auth, { email: 'own-first@example.com', name: '첫째 사용자' });
    const second = await signInThroughAdapter(auth, { email: 'own-second@example.com', name: '둘째 사용자' });
    step('실제 provider adapter로 두 계정의 서명 세션 생성');

    const runtime = await createApp({
      environment: parseEnvironment({
        NODE_ENV: 'test',
        PORT: String(API_PORT),
        CORS_ORIGINS: WEB_ORIGIN,
        DATABASE_URL: apiUrl,
        BETTER_AUTH_SECRET: testAuthSecret,
        BETTER_AUTH_URL: WEB_ORIGIN,
        GOOGLE_CLIENT_ID: 'test-client-id',
        GOOGLE_CLIENT_SECRET: 'test-client-secret'
      }),
      logWriter: () => undefined,
      databaseReadiness: { isReady: () => Promise.resolve(true) }
    });
    await runtime.listen(API_PORT, '127.0.0.1');
    step(`Nest 조립을 ${API_ORIGIN}에 연결`);
    await smoke(cookieValue(first.headers));
    await registerFirstAccount(cookieValue(first.headers));
    // 등록 시점에는 하나였던 번호가 나중에 두 party로 갈린 상태를 만든다. 셋째 사업자의 "판정 불가" 문구 재료다.
    await observeConflictingSupplier(owner);
    await seedOpenAuctionSnapshot(owner);

    // build 전환 제어. DB owner만 실행할 수 있고 harness 밖으로 나가지 않는다.
    const control = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        const { pathname } = new URL(request.url);
        if (request.method === 'POST' && pathname === '/publish-next-build') {
          await publishNextBuild(owner);
          step('다음 mart build를 활성화했다');
          return new Response(null, { status: 204 });
        }
        return new Response(null, { status: 404 });
      }
    });

    let exitCode: number;
    try {
      exitCode = await runPlaywright({
        EATBID_E2E_SESSION_COOKIE_FIRST: cookieValue(first.headers),
        EATBID_E2E_SESSION_COOKIE_SECOND: cookieValue(second.headers),
        EATBID_E2E_API_ORIGIN: API_ORIGIN,
        EATBID_E2E_CONTROL_ORIGIN: `http://127.0.0.1:${control.port}`,
        EATBID_E2E_AUCTION_ID: String(WEB_CURRENT_AUCTION_ID),
        EATBID_E2E_OBSERVED_BUSINESS_NUMBER: myBusinessNumber,
        EATBID_E2E_UNOBSERVED_BUSINESS_NUMBER: unobservedBusinessNumber,
        EATBID_E2E_CONFLICTED_BUSINESS_NUMBER: conflictedBusinessNumber
      });
    } finally {
      control.stop(true);
      // child가 끝난 뒤에만 서버를 닫는다. 먼저 닫으면 실패 원인이 "연결 거부"로 덮인다.
      await runtime.shutdown();
      step('Nest 조립 종료');
    }
    expect(exitCode).toBe(0);
  });
  step('완료');
} catch (error) {
  console.error('[own-bid-e2e] 실패', error);
  process.exitCode = 1;
}
