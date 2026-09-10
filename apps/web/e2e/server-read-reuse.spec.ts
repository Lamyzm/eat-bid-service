/**
 * @module 책임: 서버가 이미 읽은 세션과 등록 사업자를 브라우저가 다시 읽지 않는다는 것을, fixture가
 * 실제로 받은 요청 수로 고정한다. "줄었다"는 통과 여부가 아니라 숫자로 남아야 회귀를 사람이 읽는다.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { meV1Operations } from '@eatbid/contracts/api/v1/me';
import { sessionV1Operations } from '@eatbid/contracts/api/v1/session';

import { COUNTS_PATH, RESET_PATH, type ObservedRoute } from './support/cache-observability';

type Counts = Record<ObservedRoute, number>;

const SESSION_PATH = sessionV1Operations.getCurrentSession.openApiPath;
const MY_BUSINESSES_PATH = meV1Operations.listMyBusinesses.openApiPath;

// dev config와 프로덕션 config가 같은 파일을 돌리므로 fixture origin은 돌고 있는 config에서 읽는다.
function fixtureOrigin(): string {
  return String(test.info().config.metadata.fixtureOrigin);
}

/**
 * 서버가 몇 번 렌더하는지는 `next dev`와 배포가 다르다. dev는 요청마다 static shell을 다시 만들어 업무
 * layout이 두 번 렌더되고, 요청 범위 memo도 그 두 렌더를 건너지 못한다(EAT-143에서 `/today` 2회 관측).
 * 그래서 서버 쪽 횟수는 프로덕션 build 스위트에서만 판정하고 dev에서는 숫자를 로그로만 남긴다.
 */
function judgesServerReads(): boolean {
  return test.info().config.metadata.productionBuild === true;
}

/**
 * fixture 카운터는 서버 렌더와 브라우저 요청을 합쳐 센다. 이 issue가 없애려는 것은 브라우저가 보내는
 * 쪽이므로 그 쪽을 따로 세어 서버 렌더 횟수와 섞이지 않게 한다.
 */
function browserRequests(page: Page, pathname: string): { readonly count: number } {
  const observed = { count: 0 };
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === pathname) observed.count += 1;
  });
  return observed;
}

async function reset(request: APIRequestContext): Promise<void> {
  expect((await request.get(`${fixtureOrigin()}${RESET_PATH}`)).status()).toBe(204);
}

async function counts(request: APIRequestContext): Promise<Counts> {
  const response = await request.get(`${fixtureOrigin()}${COUNTS_PATH}`);
  expect(response.status()).toBe(200);
  return (await response.json()) as Counts;
}

test.describe('서버가 읽은 답의 재사용', () => {
  test('업무 화면 한 번 진입에 브라우저가 보내는 세션 계약 조회가 없다', async ({ page, request }) => {
    await reset(request);
    const sessionFromBrowser = browserRequests(page, SESSION_PATH);

    await page.goto('/today');
    // 계정 슬롯이 이름과 워크스페이스를 그렸다는 것은 브라우저가 세션 답을 실제로 소비했다는 뜻이다.
    const account = page.getByRole('button', { name: '계정 메뉴' });
    await expect(account).toContainText('검사 계정');
    await expect(account).toContainText('검사 워크스페이스');

    const observed = await counts(request);
    console.log(
      `[read-reuse-e2e] today=${JSON.stringify(observed)} browserSession=${sessionFromBrowser.count}`
    );
    expect(sessionFromBrowser.count).toBe(0);
    if (judgesServerReads()) expect(observed.session).toBe(1);
  });

  test('설정 화면은 서버가 넘긴 세션과 사업자 목록을 쓰고 붙은 뒤 다시 묻지 않는다', async ({
    page,
    request
  }) => {
    await reset(request);
    const sessionFromBrowser = browserRequests(page, SESSION_PATH);
    const businessesFromBrowser = browserRequests(page, MY_BUSINESSES_PATH);

    const response = await page.goto('/setup');
    // 목록이 서버 응답 안에 이미 실려 있어야 브라우저가 묻지 않고 그릴 수 있다.
    expect(await response!.text()).toContain('9000000035');
    await expect(page.getByRole('region', { name: '등록 사업자 900-00-00035' })).toBeVisible();
    await expect(page.getByRole('region', { name: '등록 사업자 900-00-00049' })).toBeVisible();

    const observed = await counts(request);
    console.log(
      `[read-reuse-e2e] setup=${JSON.stringify(observed)} browserSession=${sessionFromBrowser.count} browserBusinesses=${businessesFromBrowser.count}`
    );
    expect(sessionFromBrowser.count).toBe(0);
    expect(businessesFromBrowser.count).toBe(0);
    if (judgesServerReads()) {
      expect(observed.session).toBe(1);
      expect(observed.myBusinesses).toBe(1);
    }
  });
});
