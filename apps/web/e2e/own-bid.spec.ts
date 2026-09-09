/**
 * @module 책임: 실제 migration DB·실제 Nest 조립 위에서 로그인 계정의 실제 내 투찰이 결정 화면 차트에 점으로
 * 그려지고, 겹친 제출·낙찰 없는 회차·사업자 전환·계정 격리·build 전환 복구가 사용자가 보는 그대로 동작하는지
 * 브라우저로 검사한다.
 *
 * 세션 쿠키는 harness가 실제 provider adapter로 만들어 child 환경으로만 넘긴다. 캔버스 존재만으로 점을 검증하지
 * 않는다 — 점의 수는 figure 속성, 요청은 실제 POST 본문, 기록 열기는 실제 명단 요청 URL로 판정한다.
 */
import { expect, test, type Browser, type BrowserContext, type Locator, type Page, type Request } from '@playwright/test';
import { auctionV1Operations } from '@eatbid/contracts/api/v1/auctions';
import { meV1Operations, myBidObservationV1Operations } from '@eatbid/contracts/api/v1/me';

const WEB_ORIGIN = 'http://127.0.0.1:3147';

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} 환경 값이 필요합니다.`);
  return value;
}

const auctionId = requiredEnvironment('EATBID_E2E_AUCTION_ID');
const controlOrigin = requiredEnvironment('EATBID_E2E_CONTROL_ORIGIN');
const observedNumber = requiredEnvironment('EATBID_E2E_OBSERVED_BUSINESS_NUMBER');
const unobservedNumber = requiredEnvironment('EATBID_E2E_UNOBSERVED_BUSINESS_NUMBER');
const conflictedNumber = requiredEnvironment('EATBID_E2E_CONFLICTED_BUSINESS_NUMBER');
const FLOW_PATH = `/auctions/${auctionId}?view=${encodeURIComponent('흐름')}`;
const OBSERVATIONS_PATH_PATTERN = new RegExp(
  `^${myBidObservationV1Operations.findMyBidObservations.openApiPath.replace('{businessId}', '[^/]+')}$`
);
const ROSTER_PATH_PATTERN = new RegExp(`^${auctionV1Operations.roster.openApiPath.replace('{auctionId}', '([^/]+)')}$`);

function displayNumber(businessNumber: string): string {
  return `${businessNumber.slice(0, 3)}-${businessNumber.slice(3, 5)}-${businessNumber.slice(5)}`;
}

/** `name=value` 한 쌍을 브라우저 context에 그대로 심는다. 파일로 떨어뜨리지 않는다. */
async function signedInContext(browser: Browser, cookie: string): Promise<BrowserContext> {
  const separator = cookie.indexOf('=');
  const context = await browser.newContext();
  await context.addCookies([
    { name: cookie.slice(0, separator), value: cookie.slice(separator + 1), domain: '127.0.0.1', path: '/', httpOnly: true, secure: false, sameSite: 'Lax' }
  ]);
  return context;
}

/** 등록은 실제 Nest 계약으로 한다. 설정 화면의 브라우저 흐름은 인증 E2E가 이미 증명했다. */
async function registerViaApi(context: BrowserContext, numbers: readonly string[]): Promise<void> {
  const headers = { origin: WEB_ORIGIN, 'content-type': 'application/json' };
  const initialized = await context.request.post(`${WEB_ORIGIN}${meV1Operations.initializeCurrentAccount.buildPath({ path: undefined })}`, { headers });
  expect(initialized.status()).toBe(200);
  for (const businessNumber of numbers) {
    const registered = await context.request.post(`${WEB_ORIGIN}${meV1Operations.registerMyBusiness.buildPath({ path: undefined })}`, { headers, data: { businessNumber } });
    expect(registered.status()).toBe(201);
  }
}

type ObservationPost = { readonly businessId: string; readonly body: { buildId: string; organizationId: string; attempts: readonly { attemptId: string; revisionId: string }[] } };

/** 개인 batch 조회 POST와 명단 GET을 그대로 관측한다. 값은 검사 안에서만 읽고 파일로 남기지 않는다. */
function observeRequests(page: Page) {
  const posts: ObservationPost[] = [];
  const rosters: string[] = [];
  const conflicts: string[] = [];
  page.on('request', (request: Request) => {
    const url = new URL(request.url());
    if (request.method() === 'POST' && OBSERVATIONS_PATH_PATTERN.test(url.pathname)) {
      posts.push({ businessId: url.pathname.split('/').at(-2)!, body: request.postDataJSON() });
    }
    if (request.method() === 'GET' && ROSTER_PATH_PATTERN.test(url.pathname)) rosters.push(`${url.pathname}${url.search}`);
  });
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (response.status() === 409 && OBSERVATIONS_PATH_PATTERN.test(url.pathname)) conflicts.push(url.pathname);
  });
  return { posts, rosters, conflicts };
}

async function openFlow(page: Page): Promise<void> {
  await page.goto(FLOW_PATH);
  await page.locator('[data-slot="flow-canvas"] canvas').first().waitFor();
}

const controls = (page: Page) => page.locator('[data-slot="own-bid-controls"]');
const figure = (page: Page) => page.getByRole('figure', { name: '회차별 낙찰률 흐름' });
const canvas = (page: Page) => page.locator('[data-slot="flow-canvas"]');
const candidateButtons = (page: Page, pattern: RegExp) => figure(page).locator('[aria-live="polite"] button', { hasText: pattern });

async function pickBusiness(page: Page, businessNumber: string): Promise<void> {
  await page.getByRole('button', { name: '내 투찰 사업자 선택' }).click();
  await page.getByRole('menuitemradio', { name: displayNumber(businessNumber) }).click();
  // 메뉴가 닫히는 동안 portal의 inert 막이 뒤 버튼의 클릭을 가로챈다. 닫힘까지 기다려야 다음 조작이 실제로 닿는다.
  await expect(page.getByRole('menu', { name: '내 투찰 사업자 선택' })).toHaveCount(0);
}

/** 캔버스 x를 훑으며 crosshair가 그 날짜의 후보를 내놓는 자리를 찾는다. 시간축 좌표는 DOM에 없으므로 실제 마우스로 찾는다. */
async function findDayX(page: Page, pattern: RegExp): Promise<number> {
  const box = await canvas(page).boundingBox();
  if (!box) throw new Error('캔버스 상자를 읽지 못했다');
  const y = box.y + box.height * 0.4;
  const steps = 80;
  for (let step = 0; step <= steps; step += 1) {
    const x = box.x + 3 + ((box.width - 6) * step) / steps;
    await page.mouse.move(x, y);
    await page.waitForTimeout(25);
    if ((await candidateButtons(page, pattern).count()) > 0) return x;
  }
  throw new Error(`${pattern} 후보가 보이는 날짜를 캔버스에서 찾지 못했다`);
}

/** 그 x에서 세로로 실제 클릭을 이어 가며 점을 맞힌다. 4px 간격은 반지름 5px 마름모를 지나치지 않는다. */
async function clickPointAt(page: Page, x: number, region: Locator): Promise<void> {
  const box = await canvas(page).boundingBox();
  if (!box) throw new Error('캔버스 상자를 읽지 못했다');
  // 위 pane은 전체 높이의 5/6이다. 그 경계까지 훑되 아래 명단 막대 pane은 지나지 않는다.
  for (let y = box.y + 4; y <= box.y + box.height * 0.84; y += 4) {
    await page.mouse.click(x, y);
    if ((await region.count()) > 0) return;
  }
  throw new Error('세로 방향 클릭으로 점을 맞히지 못했다');
}

test.describe.configure({ mode: 'serial' });

test.describe('결정 화면의 실제 내 투찰', () => {
  let firstContext: BrowserContext;
  let firstPage: Page;
  let firstRequests: ReturnType<typeof observeRequests>;

  test.beforeAll(async ({ browser }) => {
    firstContext = await signedInContext(browser, requiredEnvironment('EATBID_E2E_SESSION_COOKIE_FIRST'));
    firstPage = await firstContext.newPage();
    firstRequests = observeRequests(firstPage);
  });

  test.afterAll(async () => {
    await firstContext.close();
  });

  test('미로그인은 로그인 안내만 보고 내 투찰을 묻지 않는다', async ({ browser }) => {
    test.setTimeout(120_000);
    const guest = await browser.newContext();
    const page = await guest.newPage();
    const requests = observeRequests(page);
    await openFlow(page);
    await expect(controls(page)).toHaveAttribute('data-own-status', 'signed-out');
    await expect(controls(page).getByRole('link', { name: 'Google로 로그인' })).toHaveAttribute('href', `/login?next=${encodeURIComponent(`/auctions/${auctionId}`)}`);
    await expect(figure(page)).toHaveAttribute('data-own-points', '0');
    expect(requests.posts).toHaveLength(0);
    await guest.close();
  });

  test('등록이 여럿이면 고르기 전까지 묻지 않고 고르면 첫 페이지 60회차를 한 번에 묻는다', async () => {
    test.setTimeout(120_000);
    // 첫째 계정의 세 등록은 harness가 실제 Nest 계약으로 마쳤다. 충돌 번호는 등록 뒤에 증거가 갈린다.
    await openFlow(firstPage);
    await expect(controls(firstPage)).toHaveAttribute('data-own-status', 'select-business');
    await expect(figure(firstPage)).toHaveAttribute('data-own-points', '0');
    expect(firstRequests.posts).toHaveLength(0);

    await pickBusiness(firstPage, observedNumber);
    await expect(controls(firstPage)).toHaveAttribute('data-own-status', 'observed');
    await expect(controls(firstPage).locator('[data-slot="own-bid-summary"]')).toContainText('내 투찰 4건(3회차)');
    await expect(figure(firstPage)).toHaveAttribute('data-own-points', '4');
    expect(firstRequests.posts).toHaveLength(1);
    const { body } = firstRequests.posts[0]!;
    expect(body.attempts).toHaveLength(60);
    expect(body.buildId).toBe('601');
    expect(body.organizationId).toBe('41');
    await firstPage.screenshot({ path: 'test-results/own-bid/observed.png', fullPage: true });
  });

  test('사업자를 바꿔도 같은 캔버스와 확대 범위를 유지한다', async () => {
    const before = await canvas(firstPage).evaluate((node) => {
      node.dataset.probe = 'same-canvas';
      return node.dataset.priceRange;
    });
    await firstPage.getByRole('button', { name: '비율 축 확대' }).click();
    const zoomed = await canvas(firstPage).getAttribute('data-price-range');
    expect(zoomed).not.toBe(before);

    await pickBusiness(firstPage, unobservedNumber);
    await expect(controls(firstPage)).toHaveAttribute('data-own-status', 'unobserved');
    await expect(controls(firstPage)).toContainText('수집 원본에 아직 이 번호가 없어');
    await expect(figure(firstPage)).toHaveAttribute('data-own-points', '0');
    expect(await canvas(firstPage).getAttribute('data-price-range')).toBe(zoomed);

    await pickBusiness(firstPage, observedNumber);
    await expect(figure(firstPage)).toHaveAttribute('data-own-points', '4');
    expect(await canvas(firstPage).getAttribute('data-price-range')).toBe(zoomed);
    // 같은 DOM 노드가 살아 있다. 캔버스를 다시 만들었다면 probe 표식이 사라진다.
    await expect(canvas(firstPage)).toHaveAttribute('data-probe', 'same-canvas');
    await firstPage.getByRole('button', { name: '기본 범위' }).click();
  });

  test('증거가 갈린 번호는 판정하지 않는다고 말한다', async () => {
    await pickBusiness(firstPage, conflictedNumber);
    await expect(controls(firstPage)).toHaveAttribute('data-own-status', 'evidence-conflict');
    await expect(controls(firstPage)).toContainText('서로 다른 두 업체를 가리켜');
    await expect(figure(firstPage)).toHaveAttribute('data-own-points', '0');
    await pickBusiness(firstPage, observedNumber);
    await expect(figure(firstPage)).toHaveAttribute('data-own-points', '4');
  });

  test('같은 날 같은 값의 두 제출은 후보로 나뉘고 고른 회차의 revision으로 기록을 연다', async () => {
    test.setTimeout(120_000);
    await findDayX(firstPage, /내 투찰 89\.500%/);
    await expect(candidateButtons(firstPage, /내 투찰 89\.500%/)).toHaveCount(2);
    await firstPage.screenshot({ path: 'test-results/own-bid/overlap-candidates.png' });
    const rostersBefore = firstRequests.rosters.length;
    // 같은 날에는 8202의 낙찰 점 후보도 있다. 실제 제출 후보만 고른다.
    await candidateButtons(firstPage, /내 투찰 89\.500%.*회차 8202$/).click();
    const region = firstPage.getByRole('region', { name: '선택 회차 참여 기록' });
    await expect(region).toBeVisible();
    await expect(region).toContainText('회차 8202');
    await expect(region.locator('tbody tr')).toHaveCount(2);
    expect(firstRequests.rosters.slice(rostersBefore).some((url) => url.includes('/auctions/8202/roster') && url.includes('revisionId=9202'))).toBe(true);
    await firstPage.getByRole('button', { name: '보조 패널 닫기' }).click();
  });

  test('낙찰이 없는 회차의 내 점을 캔버스에서 눌러 같은 회차·revision 기록을 열고 자리표시자 금액을 보이지 않는다', async () => {
    test.setTimeout(120_000);
    const x = await findDayX(firstPage, /회차 8101$/);
    await expect(candidateButtons(firstPage, /내 투찰 101\.975% · 금액 미확인/)).toHaveCount(1);
    const rostersBefore = firstRequests.rosters.length;
    const region = firstPage.getByRole('region', { name: '선택 회차 참여 기록' });
    await clickPointAt(firstPage, x, region);
    await expect(region).toContainText('회차 8101');
    await expect(region.locator('tbody tr')).toHaveCount(3);
    await expect(region.locator('text=10,000,000,043,768')).toHaveCount(0);
    expect(firstRequests.rosters.slice(rostersBefore).some((url) => url.includes('/auctions/8101/roster') && url.includes('revisionId=9101'))).toBe(true);
    await firstPage.screenshot({ path: 'test-results/own-bid/own-only-roster.png', fullPage: true });
    await firstPage.getByRole('button', { name: '보조 패널 닫기' }).click();
  });

  test('자료 기준이 바뀌면 latest로 한 번 옮겨 같은 새 기준의 표와 점을 다시 그린다', async () => {
    test.setTimeout(120_000);
    // 새로 연 화면은 아직 사업자를 고르기 전이라 개인 조회가 나가지 않는다. 그 사이에 build를 바꾸면 화면은
    // 이전 build의 회차 이력을 들고 있고, 사업자를 고르는 순간의 조회가 실제 409를 만난다.
    await firstPage.goto(FLOW_PATH);
    await firstPage.locator('[data-slot="flow-canvas"] canvas').first().waitFor();
    await expect(controls(firstPage)).toHaveAttribute('data-own-status', 'select-business');
    const published = await firstContext.request.post(`${controlOrigin}/publish-next-build`);
    expect(published.status()).toBe(204);
    const postsBefore = firstRequests.posts.length;

    await pickBusiness(firstPage, observedNumber);
    await expect(firstPage).toHaveURL(/historyRead=latest/);
    // 새 화면이 선택을 잃었다면 한 번 더 고른다. 자동 전환은 한 번뿐이어야 하므로 URL은 이미 latest다.
    if ((await controls(firstPage).getAttribute('data-own-status')) === 'select-business') {
      await pickBusiness(firstPage, observedNumber);
    }
    await expect(controls(firstPage)).toHaveAttribute('data-own-status', 'observed');
    const summary = controls(firstPage).locator('[data-slot="own-bid-summary"]');
    await expect(summary).toContainText('내 투찰 2건(2회차)');
    await expect(figure(firstPage)).toHaveAttribute('data-own-points', '2');
    const posts = firstRequests.posts.slice(postsBefore);
    expect(posts.map((post) => post.body.buildId)).toEqual(['601', '602']);
    expect(firstRequests.conflicts).toHaveLength(1);
    await firstPage.screenshot({ path: 'test-results/own-bid/build-recovered.png', fullPage: true });
  });

  test('로그아웃하면 점과 문구가 사라지고 다른 계정은 앞 계정의 점을 보지 못한다', async ({ browser }) => {
    test.setTimeout(120_000);
    // next dev의 issue 배지가 사이드바 바닥의 계정 메뉴를 덮어 포인터 클릭을 가로챈다. 키보드로 같은 경로를 연다.
    await firstPage.getByRole('button', { name: '계정 메뉴' }).focus();
    await firstPage.keyboard.press('Enter');
    const logout = firstPage.getByRole('menuitem', { name: '로그아웃' });
    await logout.waitFor();
    await logout.focus();
    await firstPage.keyboard.press('Enter');
    await expect(controls(firstPage)).toHaveAttribute('data-own-status', 'signed-out');
    await expect(figure(firstPage)).toHaveAttribute('data-own-points', '0');

    const secondContext = await signedInContext(browser, requiredEnvironment('EATBID_E2E_SESSION_COOKIE_SECOND'));
    await registerViaApi(secondContext, [unobservedNumber]);
    const secondPage = await secondContext.newPage();
    const secondRequests = observeRequests(secondPage);
    await openFlow(secondPage);
    await expect(controls(secondPage)).toHaveAttribute('data-own-status', 'unobserved');
    await expect(figure(secondPage)).toHaveAttribute('data-own-points', '0');
    await expect(controls(secondPage)).not.toContainText('내 투찰 4건');
    // 회차 이력 RSC 캐시가 아직 이전 build를 들고 있으면 첫 조회가 409를 만나고 latest로 한 번 옮겨 다시 묻는다.
    // 어느 경로든 마지막 조회는 활성 build이고 전환은 한 번을 넘지 않는다.
    expect(secondRequests.conflicts.length).toBeLessThanOrEqual(1);
    expect(secondRequests.posts).toHaveLength(1 + secondRequests.conflicts.length);
    expect(secondRequests.posts.at(-1)!.body.buildId).toBe('602');
    await secondContext.close();
  });
});
