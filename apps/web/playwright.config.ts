import { defineConfig } from '@playwright/test';

const WEB_ORIGIN = 'http://127.0.0.1:3101';
const FIXTURE_ORIGIN = 'http://127.0.0.1:4410';
const FIXTURE_START_TIMEOUT_MILLISECONDS = 30_000;
const WEB_START_TIMEOUT_MILLISECONDS = 120_000;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
  outputDir: 'test-results/foundation',
  use: {
    baseURL: WEB_ORIGIN,
    browserName: 'chromium',
    trace: 'retain-on-failure'
  },
  webServer: [
    {
      command: 'bun e2e/support/auction-contract-fixture-server.ts',
      url: `${FIXTURE_ORIGIN}/health`,
      reuseExistingServer: false,
      timeout: FIXTURE_START_TIMEOUT_MILLISECONDS
    },
    {
      command: 'pnpm exec next dev --hostname 127.0.0.1 --port 3101',
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
