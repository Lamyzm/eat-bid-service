import { defineConfig } from '@playwright/test';

// dev 모드의 `use cache` 수명은 프로덕션과 다르다. dev에서 통과한 캐시 테스트는 배포된 동작의
// 증거가 아니므로 이 스위트만 `next build && next start`로 돈다(ADR 0036, 판정 §4).
// 기존 두 스위트와 동시에 돌 수 있도록 web·fixture 포트를 모두 따로 쓴다.
const WEB_ORIGIN = 'http://127.0.0.1:3102';
const FIXTURE_PORT = '4411';
const FIXTURE_ORIGIN = `http://127.0.0.1:${FIXTURE_PORT}`;
const FIXTURE_START_TIMEOUT_MILLISECONDS = 30_000;
// 프로덕션 build 한 번이 이 스위트의 비용이다. 그 비용을 내는 이유가 dev와 다른 캐시 수명이다.
const WEB_START_TIMEOUT_MILLISECONDS = 600_000;

// fixture 전용 토큰이다. 운영 값은 Infisical `/runtime/web`에만 있으며 저장소에 들어오지 않는다.
export const CACHE_REVALIDATE_TOKEN = 'cache-e2e-fixture-token';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/cache-invalidation.spec.ts',
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
  outputDir: 'test-results/cache',
  use: {
    baseURL: WEB_ORIGIN,
    browserName: 'chromium',
    trace: 'retain-on-failure'
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
      command: 'pnpm exec next build && pnpm exec next start --hostname 127.0.0.1 --port 3102',
      url: WEB_ORIGIN,
      env: {
        API_URL: FIXTURE_ORIGIN,
        NEXT_PUBLIC_SENTRY_DISABLED: 'true',
        EATBID_CACHE_REVALIDATE_TOKEN: CACHE_REVALIDATE_TOKEN
      },
      reuseExistingServer: false,
      timeout: WEB_START_TIMEOUT_MILLISECONDS
    }
  ]
});

export { FIXTURE_ORIGIN };
