import { defineConfig } from '@playwright/test';

// 내 투찰 E2E는 실제 Nest 조립과 일회용 PostgreSQL을 쓰므로 정적 fixture 스위트(3101/4410)와 포트를 나눈다.
// 인증 E2E(3147/4447)와 같은 포트를 쓰지만 두 스위트는 같은 harness 규약을 따르고 동시에 돌지 않는다.
const WEB_ORIGIN = 'http://127.0.0.1:3147';
const WEB_START_TIMEOUT_MILLISECONDS = 180_000;

export default defineConfig({
  testDir: './e2e',
  testMatch: 'own-bid.spec.ts',
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
  outputDir: 'test-results/own-bid',
  use: {
    baseURL: WEB_ORIGIN,
    browserName: 'chromium',
    // 데스크톱 결정 화면 기준 폭이다. 기본 720 높이에서는 차트 조작 줄이 sticky 헤더 아래로 밀려 클릭이 가로채인다.
    viewport: { width: 1440, height: 1000 },
    // 세션 쿠키는 메모리로만 오간다. trace와 storageState는 그 값을 파일로 남기므로 켜지 않는다.
    trace: 'off'
  },
  webServer: [
    {
      command: 'pnpm exec next dev --hostname 127.0.0.1 --port 3147',
      url: WEB_ORIGIN,
      env: {
        // Bun harness가 NODE_ENV=test로 실행되지만 config/api-rewrites.ts는 development에서만 rewrite를
        // 만든다. 상속하면 `/api/**`가 Nest에 닿지 않아 인증 실패와 배선 누락을 구분할 수 없다.
        NODE_ENV: 'development',
        API_URL: process.env.EATBID_E2E_API_ORIGIN ?? '',
        NEXT_PUBLIC_SENTRY_DISABLED: 'true'
      },
      reuseExistingServer: false,
      timeout: WEB_START_TIMEOUT_MILLISECONDS
    }
  ]
});
