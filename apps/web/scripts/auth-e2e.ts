/**
 * @module 책임: 인증 E2E가 실제 migration DB·실제 Nest 조립·실제 서명 세션 위에서 돌도록 수명주기를
 * 열고 닫고, Playwright child에 세션 쿠키를 메모리로만 넘긴다.
 *
 * Bun으로 직접 실행하는 이유는 둘이다. 저장소의 disposable database fixture가 `bun:test`의 `expect`와
 * `Bun.spawn`을 쓰므로 Node Playwright worker에서 그대로 import할 수 없고, `bun test`로 실행하면 web의
 * happy-dom preload가 서버 조립이 쓰는 전역까지 바꿔 버린다. Playwright는 기존 Node CLI를 child로 띄운다.
 */
// 실행 cwd는 `apps/server`다. Bun은 진입점의 project tsconfig 하나로 전부 transpile하는데, web tsconfig에는
// `emitDecoratorMetadata`가 없어 Nest DI가 생성자 타입을 잃고 bootstrap이 `abortOnError`로 조용히 죽는다.
// Playwright child의 cwd는 이 파일 위치에서 따로 계산하므로 실행 cwd에 매이지 않는다. 같은 이유로 이
// 파일은 web tsconfig의 exclude에 있다. web 설정으로 server 소스를 다시 검사하면 이 harness와 무관한
// 오류가 web typecheck의 결과가 된다.
import { expect } from 'bun:test';
import { createApp } from '../../server/src/bootstrap/create-app';
import { parseEnvironment } from '../../server/src/platform/config/environment';
import { withAccountDatabase } from '../../server/fixtures/account.fixture';
import {
  createTestAuth,
  signInThroughAdapter,
  testAuthSecret
} from '../../server/fixtures/auth-session.fixture';

const WEB_ORIGIN = 'http://127.0.0.1:3147';
const API_ORIGIN = 'http://127.0.0.1:4447';
const API_PORT = 4447;
const webDirectory = new URL('..', import.meta.url);

/**
 * 합성 사업자등록번호다. 검증번호는 통과하지만 실제 납품업체의 번호가 아니다. 하나는 원본 관측이 있는
 * 상태를, 다른 하나는 아직 관측되지 않은 상태를 만들어 두 표현이 실제로 갈라지는지 본다.
 */
const OBSERVED_SYNTHETIC_NUMBER = '9000000016';
const UNOBSERVED_SYNTHETIC_NUMBER = '9000000020';
const SYNTHETIC_CODE_VALUE_ID = 9007199254741001n;
const SYNTHETIC_SUPPLIER_PARTY_ID = 9007199254741003n;

// EAT-114 명단 seed에는 번호→SupplierParty 관계가 없다. 그 관계가 없으면 "관측됨"과 "미관측"의 차이를
// 화면에서 대조할 수 없어 대조 실패와 미관측을 구분하지 못한다.
const syntheticSupplierSql = `
  insert into core.code_value (code_value_id, code_scheme_id, code)
  overriding system value
  values (${SYNTHETIC_CODE_VALUE_ID}, 9007199254740993, '${OBSERVED_SYNTHETIC_NUMBER}');
  insert into core.supplier_party (supplier_party_id, type, business_number_code_value_id)
  overriding system value
  values (${SYNTHETIC_SUPPLIER_PARTY_ID}, 'company', ${SYNTHETIC_CODE_VALUE_ID});
`;

function cookieValue(headers: Headers): string {
  const cookie = headers.get('cookie');
  if (!cookie) throw new Error('서명된 세션 쿠키가 필요합니다.');
  return cookie;
}

async function runPlaywright(cookies: {
  readonly first: string;
  readonly second: string;
}): Promise<number> {
  const child = Bun.spawn(
    ['pnpm', 'exec', 'playwright', 'test', '--config', 'playwright.auth.config.ts'],
    {
      cwd: Bun.fileURLToPath(webDirectory),
      stdio: ['inherit', 'inherit', 'inherit'],
      env: {
        ...process.env,
        // 쿠키는 child 전용 환경으로만 건넨다. 명령 인자, 파일, 공개 helper endpoint에 남기지 않는다.
        EATBID_E2E_SESSION_COOKIE_FIRST: cookies.first,
        EATBID_E2E_SESSION_COOKIE_SECOND: cookies.second,
        EATBID_E2E_API_ORIGIN: API_ORIGIN,
        EATBID_E2E_OBSERVED_BUSINESS_NUMBER: OBSERVED_SYNTHETIC_NUMBER,
        EATBID_E2E_UNOBSERVED_BUSINESS_NUMBER: UNOBSERVED_SYNTHETIC_NUMBER
      }
    }
  );
  return await child.exited;
}

// 실패를 조용히 종료 코드로만 남기지 않는다. 이 harness는 container·서버·browser 세 수명주기를 걸치므로
// 어느 단계에서 멈췄는지가 곧 진단이다.
function step(message: string): void {
  console.log(`[auth-e2e] ${message}`);
}

try {
  await withAccountDatabase(async ({ api, apiUrl, owner }) => {
    step('일회용 PostgreSQL 준비 완료');
    await owner.unsafe(syntheticSupplierSql);
    const { auth } = createTestAuth(api);
    const first = await signInThroughAdapter(auth, {
      email: 'e2e-first@example.com',
      name: '첫째 사용자'
    });
    const second = await signInThroughAdapter(auth, {
      email: 'e2e-second@example.com',
      name: '둘째 사용자'
    });
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

    let exitCode: number;
    try {
      exitCode = await runPlaywright({
        first: cookieValue(first.headers),
        second: cookieValue(second.headers)
      });
    } finally {
      // child가 끝난 뒤에만 서버를 닫는다. 먼저 닫으면 실패 원인이 "연결 거부"로 덮인다.
      await runtime.shutdown();
      step('Nest 조립 종료');
    }
    expect(exitCode).toBe(0);
  });
  step('완료');
} catch (error) {
  console.error('[auth-e2e] 실패', error);
  process.exitCode = 1;
}
