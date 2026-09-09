/**
 * @module 책임: 실제 migration DB·실제 Nest 조립 위에서 로그인 계정의 사업자 설정이 계정별로 격리되고
 * 서버에서 복원되며 위조·로그아웃 세션을 거부하는지 브라우저로 검사한다.
 *
 * 세션 쿠키는 harness가 실제 provider adapter로 만들어 child 환경으로만 넘긴다. 이 스위트는 공개
 * fake-login endpoint도 토큰 파일도 만들지 않으며, 실제 Google 왕복은 여기서 증명하지 않는다.
 */
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { meV1Operations } from '@eatbid/contracts/api/v1/me';

const WEB_ORIGIN = 'http://127.0.0.1:3147';
/** 이 스위트는 공고 화면을 열지 않는다. 복귀 경로가 보존되는지만 URL과 링크로 확인한다. */
const AUCTION_PATH = '/auctions/5796468';
const ENCODED_AUCTION_PATH = encodeURIComponent(AUCTION_PATH);
const initializationPath = meV1Operations.initializeCurrentAccount.buildPath({ path: undefined });
const locationPath = (businessId: string) =>
  meV1Operations.setMyBusinessLocation.buildPath({ path: { businessId } });

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} 환경 값이 필요합니다.`);
  return value;
}

const observedNumber = requiredEnvironment('EATBID_E2E_OBSERVED_BUSINESS_NUMBER');
const unobservedNumber = requiredEnvironment('EATBID_E2E_UNOBSERVED_BUSINESS_NUMBER');
/** 둘째 계정만 저장하는 주소다. 첫째 계정 화면과 로그아웃 뒤 화면에서 이 값이 보이면 격리가 깨진 것이다. */
const SECOND_ADDRESS = '서울특별시 중구 세종대로 110';

/** `name=value` 한 쌍을 브라우저 context에 그대로 심는다. 파일로 떨어뜨리지 않는다. */
async function signedInContext(browser: Browser, cookie: string): Promise<BrowserContext> {
  const separator = cookie.indexOf('=');
  const context = await browser.newContext();
  await context.addCookies([
    {
      name: cookie.slice(0, separator),
      value: cookie.slice(separator + 1),
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax'
    }
  ]);
  return context;
}

async function initializeAccount(page: Page): Promise<void> {
  await page.goto('/setup');
  await page.getByRole('button', { name: '시작하기' }).click();
  await expect(page.getByLabel('사업자등록번호')).toBeVisible();
}

async function registerBusiness(page: Page, businessNumber: string): Promise<void> {
  await page.getByLabel('사업자등록번호').fill(businessNumber);
  await page.getByRole('button', { name: '등록', exact: true }).click();
  await expect(page.getByText(displayNumber(businessNumber))).toBeVisible();
}

function displayNumber(businessNumber: string): string {
  return `${businessNumber.slice(0, 3)}-${businessNumber.slice(3, 5)}-${businessNumber.slice(5)}`;
}

function businessSection(page: Page, businessNumber: string) {
  return page.getByRole('region', { name: `등록 사업자 ${displayNumber(businessNumber)}` });
}

test.describe.configure({ mode: 'serial' });

test.describe('로그인 계정의 사업자 설정', () => {
  let firstContext: BrowserContext;
  let secondContext: BrowserContext;
  let firstPage: Page;
  let secondPage: Page;

  test.beforeAll(async ({ browser }) => {
    firstContext = await signedInContext(browser, requiredEnvironment('EATBID_E2E_SESSION_COOKIE_FIRST'));
    secondContext = await signedInContext(browser, requiredEnvironment('EATBID_E2E_SESSION_COOKIE_SECOND'));
    firstPage = await firstContext.newPage();
    secondPage = await secondContext.newPage();
  });

  test.afterAll(async () => {
    await firstContext.close();
    await secondContext.close();
  });

  test('미로그인 방문자는 설정 대신 로그인 화면으로 가고 공개 화면은 그대로 열린다', async ({ browser }) => {
    const guest = await browser.newContext();
    const page = await guest.newPage();

    await page.goto('/setup');
    await expect(page).toHaveURL(`${WEB_ORIGIN}/login?next=%2Fsetup`);
    await expect(page.getByRole('button', { name: 'Google로 로그인' })).toBeEnabled();

    // 보던 공고에서 설정으로 왔다면 로그인 화면까지 그 경로를 잃지 않는다.
    await page.goto(`/setup?next=${ENCODED_AUCTION_PATH}`);
    await expect(page).toHaveURL(`${WEB_ORIGIN}/login?next=${ENCODED_AUCTION_PATH}`);

    await page.goto('/today');
    await expect(page.getByRole('region', { name: '열린 공고' })).toBeVisible();
    await guest.close();
  });

  test('초기화 실패는 세션을 지우지 않고 같은 버튼으로 다시 시도할 수 있다', async () => {
    await firstPage.route(`**${initializationPath}`, (route) => route.abort());
    await firstPage.goto('/setup');
    const initialize = firstPage.getByRole('button', { name: '시작하기' });
    await initialize.click();
    await expect(firstPage.getByText('시작하지 못했습니다')).toBeVisible();
    // 실패했다고 로그아웃시키지 않는다. 같은 화면에 같은 버튼이 남아 있어야 복구가 사용자 손에 있다.
    await expect(initialize).toBeEnabled();

    await firstPage.unroute(`**${initializationPath}`);
    await initialize.click();
    await expect(firstPage.getByLabel('사업자등록번호')).toBeVisible();
  });

  test('관측된 번호와 미관측 번호를 모두 저장하고 두 상태를 다른 문장으로 구분한다', async () => {
    await registerBusiness(firstPage, observedNumber);
    await registerBusiness(firstPage, unobservedNumber);

    await expect(businessSection(firstPage, observedNumber).getByText('수집 원본에서 이 번호를 확인했습니다')).toBeVisible();
    await expect(businessSection(firstPage, unobservedNumber).getByText('수집 원본에 아직 이 번호가 없습니다')).toBeVisible();
    await expect(firstPage.getByText('참여 기록 없음')).toHaveCount(0);
    await firstPage.screenshot({ path: 'test-results/auth/setup-registered.png', fullPage: true });
  });

  test('키보드만으로 번호를 입력하고 Enter로 등록을 제출한다', async () => {
    // 검증번호를 통과하는 또 다른 합성 번호다. 실제 납품업체의 번호를 쓰지 않는다.
    const another = '9000000035';
    await firstPage.getByLabel('사업자등록번호').focus();
    await firstPage.keyboard.type(another);
    await firstPage.keyboard.press('Enter');

    await expect(firstPage.getByText(displayNumber(another))).toBeVisible();
    // 성공한 등록은 입력을 비워 같은 번호가 두 번 제출되지 않게 한다.
    await expect(firstPage.getByLabel('사업자등록번호')).toHaveValue('');
  });

  test('형식이 틀린 번호는 서버에 보내기 전에 화면이 이유를 말한다', async () => {
    await firstPage.getByLabel('사업자등록번호').fill('124-81-00997');
    await firstPage.getByRole('button', { name: '등록', exact: true }).click();

    await expect(firstPage.getByText('숫자 열 자리 사업자등록번호를 확인해 주세요')).toBeVisible();
    // 형식 실패는 서버에 가지 않는다. 등록 수가 늘지 않았음을 목록 길이로 확인한다.
    await expect(firstPage.getByRole('region', { name: /^등록 사업자 / })).toHaveCount(3);
    await firstPage.getByLabel('사업자등록번호').fill('');
  });

  test('같은 번호를 두 번 등록하면 이미 등록됐다고 말한다', async () => {
    await firstPage.getByLabel('사업자등록번호').fill(observedNumber);
    await firstPage.getByRole('button', { name: '등록', exact: true }).click();

    await expect(firstPage.getByText('이미 등록된 사업자이거나 등록 가능한 수를 넘었습니다.')).toBeVisible();
    await firstPage.getByLabel('사업자등록번호').fill('');
  });

  test('사업장 주소를 저장하고 비우면 실제로 지워지며 새로고침 뒤 서버에서 복원된다', async () => {
    const section = businessSection(firstPage, observedNumber);
    await section.getByLabel('사업장 주소 (선택)').fill('경상남도 김해시 김해대로 2401');
    await section.getByRole('button', { name: '저장' }).click();
    await expect(section.getByRole('button', { name: '주소 지우기' })).toBeVisible();

    await firstPage.reload();
    const restored = businessSection(firstPage, observedNumber);
    await expect(restored.getByLabel('사업장 주소 (선택)')).toHaveValue('경상남도 김해시 김해대로 2401');

    await restored.getByRole('button', { name: '주소 지우기' }).click();
    await expect(restored.getByRole('button', { name: '주소 지우기' })).toHaveCount(0);
    await firstPage.reload();
    await expect(businessSection(firstPage, observedNumber).getByLabel('사업장 주소 (선택)')).toHaveValue('');
  });

  test('로그인만 끝난 계정도 보던 공고로 돌아갈 경로를 잃지 않는다', async () => {
    await secondPage.goto(`/login?next=${ENCODED_AUCTION_PATH}`);

    // 아직 시작하지 않은 계정은 로그인 화면에 머물지 않고 설정으로 가되 돌아갈 곳을 그대로 가져간다.
    await expect(secondPage).toHaveURL(`${WEB_ORIGIN}/setup?next=${ENCODED_AUCTION_PATH}`);
    await expect(secondPage.getByRole('link', { name: '공고로 돌아가기' })).toHaveAttribute(
      'href',
      AUCTION_PATH
    );
  });

  test('다른 계정은 같은 번호를 등록할 수 있고 서로의 목록과 주소를 보지 못한다', async () => {
    await initializeAccount(secondPage);
    await expect(secondPage.getByText('아직 등록한 사업자가 없습니다.')).toBeVisible();

    await registerBusiness(secondPage, observedNumber);
    const section = businessSection(secondPage, observedNumber);
    await section.getByLabel('사업장 주소 (선택)').fill(SECOND_ADDRESS);
    await section.getByRole('button', { name: '저장' }).click();
    await expect(section.getByRole('button', { name: '주소 지우기' })).toBeVisible();

    await firstPage.reload();
    // 둘째 계정만 등록한 번호가 첫째 계정 화면에 나타나면 안 되고, 주소도 계정별로 남는다.
    // 주소는 입력 값이라 text 검색으로는 없다는 사실을 증명하지 못한다. 값 자체로 확인한다.
    for (const input of await firstPage.getByLabel('사업장 주소 (선택)').all()) {
      await expect(input).not.toHaveValue(SECOND_ADDRESS);
    }
    await expect(businessSection(firstPage, observedNumber).getByLabel('사업장 주소 (선택)')).toHaveValue('');
    await expect(secondPage.getByText(displayNumber(unobservedNumber))).toHaveCount(0);
  });

  test('남의 등록 id로 보낸 위치 변경은 서버가 거부한다', async () => {
    const businesses = await firstPage.evaluate(async (path) => {
      const response = await fetch(path, { headers: { accept: 'application/json' } });
      return (await response.json()) as { businesses: { businessId: string }[] };
    }, meV1Operations.listMyBusinesses.buildPath({ path: undefined }));
    const foreignId = businesses.businesses[0]?.businessId;
    expect(foreignId).toBeDefined();

    const forged = await secondContext.request.put(`${WEB_ORIGIN}${locationPath(foreignId!)}`, {
      headers: { origin: WEB_ORIGIN, 'content-type': 'application/json' },
      data: { addressText: '남의 사업장' }
    });

    expect(forged.status()).toBe(403);
  });

  test('로그아웃하면 개인 자료가 사라지고 그 세션 쿠키는 다시 쓸 수 없다', async ({ browser }) => {
    const reusedCookie = requiredEnvironment('EATBID_E2E_SESSION_COOKIE_SECOND');
    // 사라졌다는 확인이 뜻을 가지려면 로그아웃 전에 실제로 보이던 값이어야 한다.
    await expect(businessSection(secondPage, observedNumber).getByLabel('사업장 주소 (선택)')).toHaveValue(
      SECOND_ADDRESS
    );

    await secondPage.getByRole('button', { name: '계정 메뉴' }).click();
    await secondPage.getByRole('menuitem', { name: '로그아웃' }).click();
    await expect(secondPage.getByRole('button', { name: '계정 메뉴' })).toContainText('로그인하지 않음');
    // 등록 화면 자체가 사라져야 하고 주소 입력도 남지 않아야 한다.
    await expect(secondPage.getByRole('region', { name: /^등록 사업자 / })).toHaveCount(0);
    await expect(secondPage.getByLabel('사업장 주소 (선택)')).toHaveCount(0);

    const replay = await signedInContext(browser, reusedCookie);
    const page = await replay.newPage();
    await page.goto('/setup');
    await expect(page).toHaveURL(`${WEB_ORIGIN}/login?next=%2Fsetup`);
    await replay.close();
  });

  test('전역 메뉴의 사업자 진입은 canonical 설정 하나로 모인다', async () => {
    await firstPage.goto('/today');
    await firstPage.getByRole('link', { name: '내 사업자' }).click();
    await expect(firstPage).toHaveURL(`${WEB_ORIGIN}/setup`);
  });
});
