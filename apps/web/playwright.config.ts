import { defineConfig } from '@playwright/test';

import { signedInStorageState } from './e2e/support/session-fixture';

const HOST = '127.0.0.1';
// 기본 포트는 CI와 저장소 문서가 쓰는 값이다. 운영체제가 특정 대역을 예약해 둔 개발 기기에서도 같은
// 스위트를 돌릴 수 있도록 환경 값으로만 바꾼다. 값을 바꿔도 스위트의 판정은 달라지지 않는다.
const WEB_PORT = process.env.EATBID_E2E_WEB_PORT ?? '3101';
const FIXTURE_PORT = process.env.EATBID_FIXTURE_PORT ?? '4410';
const WEB_ORIGIN = `http://${HOST}:${WEB_PORT}`;
const FIXTURE_ORIGIN = `http://${HOST}:${FIXTURE_PORT}`;
const FIXTURE_START_TIMEOUT_MILLISECONDS = 30_000;
const WEB_START_TIMEOUT_MILLISECONDS = 120_000;

export default defineConfig({
  testDir: './e2e',
  // 캐시 스위트는 프로덕션 build로만 의미가 있다. 여기서 함께 돌면 dev 모드 결과를 배포 동작의
  // 증거로 착각하게 되므로 config 자체를 나눈다(playwright.cache.config.ts).
  testIgnore: '**/cache-invalidation.spec.ts',
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
  outputDir: 'test-results/foundation',
  use: {
    baseURL: WEB_ORIGIN,
    browserName: 'chromium',
    trace: 'retain-on-failure',
    // 업무 화면은 로그인해야 열린다. 화면을 검사하는 스위트는 로그인 상태에서 시작하고, 게이트 자체를
    // 검사하는 스위트만 이 상태를 비운다.
    storageState: signedInStorageState(HOST)
  },
  webServer: [
    {
      command: 'bun e2e/support/auction-contract-fixture-server.ts',
      url: `${FIXTURE_ORIGIN}/health`,
      env: { EATBID_FIXTURE_PORT: FIXTURE_PORT },
      reuseExistingServer: false,
      timeout: FIXTURE_START_TIMEOUT_MILLISECONDS
    },
    {
      command: `pnpm exec next dev --hostname ${HOST} --port ${WEB_PORT}`,
      url: WEB_ORIGIN,
      env: {
        API_URL: FIXTURE_ORIGIN,
        NEXT_PUBLIC_SENTRY_DISABLED: 'true'
      },
      reuseExistingServer: false,
      timeout: WEB_START_TIMEOUT_MILLISECONDS
    }
  ]
});
