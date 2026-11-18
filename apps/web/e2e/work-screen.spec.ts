/**
 * @module 책임: 넣을 공고(#241 정본)가 폭과 사업장 수마다 첫 화면에 정해진 공고 줄 수를 들이고, 누를 수 있는 것이 마감일 칩과
 * 메뉴뿐이며, 사업장 이름을 자르거나 문서를 옆으로 밀지 않는지 검사한다. 이 route는 RSC가 서버에서 공고 한 장과 사업장 목록을
 * 조회하므로 fixture 서버가 응답한다. 운영자·사업장 수는 세션 쿠키 값(`fixture-owner-N`)으로 고른다.
 */
import { expect, test, type Page } from '@playwright/test';

import {
  OWNER_SESSION_COOKIE_PREFIX,
  SESSION_COOKIE_NAME,
  signedInStorageState
} from './support/session-fixture';
import { VIEWPORT_WIDTH } from './support/viewports';

const HEIGHT = 768;
const FIVE = ['오뚜기축산', '신성유통', '한빛정육', '대성미트', '청솔식품'];

/** 앱 창 맨 위에서 첫 화면 안에 온전히 들어온 공고 줄 수다. */
async function rowsAboveFold(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      [...document.querySelectorAll('[data-slot="notice-row"]')].filter(
        (row) => row.getBoundingClientRect().bottom <= window.innerHeight
      ).length
  );
}

async function documentOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

async function openWork(page: Page, width: number) {
  await page.setViewportSize({ width, height: HEIGHT });
  await page.goto('/work');
  await expect(page.getByRole('heading', { name: '넣을 공고', level: 1 })).toBeVisible();
  await expect(page.getByRole('group', { name: '마감일' })).toBeVisible();
}

// 정본 인수 기준의 첫 화면 공고 줄 수다(1366 2곳·5곳 6줄, 1024 2곳 6줄·5곳 5줄, 683 2곳 4줄·5곳 2줄 이상).
const FOLD = [
  { businesses: 2, width: 1366, rows: 6 },
  { businesses: 5, width: 1366, rows: 6 },
  { businesses: 2, width: VIEWPORT_WIDTH.lg, rows: 6 },
  { businesses: 5, width: VIEWPORT_WIDTH.lg, rows: 5 },
  { businesses: 2, width: 683, rows: 4 },
  { businesses: 5, width: 683, rows: 2 }
] as const;

for (const businesses of [2, 5] as const) {
  test.describe(`사업장 ${businesses}곳`, () => {
    test.use({
      storageState: signedInStorageState('127.0.0.1', `${OWNER_SESSION_COOKIE_PREFIX}${businesses}`)
    });

    for (const fold of FOLD.filter((entry) => entry.businesses === businesses)) {
      test(`${fold.width}×768에서 첫 화면에 공고 줄을 ${fold.rows}줄 이상 들이고 이름을 자르거나 문서를 밀지 않는다`, async ({
        page
      }) => {
        await openWork(page, fold.width);
        expect(await rowsAboveFold(page)).toBeGreaterThanOrEqual(fold.rows);
        expect(await documentOverflow(page)).toBeLessThanOrEqual(0);
        const panel = page.getByRole('complementary', { name: '10월 값' });
        for (const name of FIVE.slice(0, businesses)) {
          const label = panel.getByText(name, { exact: true });
          await expect(label).toBeVisible();
          expect(await label.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
        }
      });
    }
  });
}

test.describe('운영자 사업장 2곳', () => {
  test.use({ storageState: signedInStorageState('127.0.0.1', `${OWNER_SESSION_COOKIE_PREFIX}2`) });

  test('이달 하한 90% 값은 판에, 88% 값은 묶음 머리에 사업장마다 기초금액 대비 %로 보인다', async ({
    page
  }) => {
    await openWork(page, 1366);
    await expect(page.getByText('10월 21일 (수) 저녁 7시 기준')).toBeVisible();
    const panel = page.getByRole('complementary', { name: '10월 값' });
    await expect(panel).toContainText('하한 90%');
    await expect(panel).toContainText('오뚜기축산88.641%');
    await expect(panel).toContainText('신성유통89.010%');
    const group88 = page.getByRole('region', { name: '하한 88% 3건' });
    await expect(group88.getByRole('list', { name: '사업장별 값' })).toContainText(
      '오뚜기축산86.724%'
    );
    await expect(group88.getByRole('list', { name: '사업장별 값' })).toContainText(
      '신성유통87.164%'
    );
    await expect(group88).toContainText('장유고등학교');
    await expect(page.getByRole('region', { name: '하한 90% 16건' })).toContainText(
      '김해삼성초등학교'
    );
  });

  test('마감일 칩은 내일부터이고 고르면 그날 공고로 바뀐다', async ({ page }) => {
    await openWork(page, 1366);
    const chips = page.getByRole('group', { name: '마감일' }).getByRole('button');
    // 칩의 이름은 날과 건수 사이를 띄워 "내일 22일 (목) 19건"으로 읽힌다.
    for (const [index, name] of [
      '내일 22일 (목) 19건',
      '23일 (금) 16건',
      '26일 (월) 17건',
      '27일 (화) 2건',
      '28일 (수) 1건'
    ].entries())
      await expect(chips.nth(index)).toHaveAccessibleName(name);
    await expect(chips.first()).toHaveAttribute('aria-current', 'true');
    await chips.nth(1).click();
    await expect(chips.nth(1)).toHaveAttribute('aria-current', 'true');
    await expect(page.getByRole('region', { name: '하한 88% 1건' })).toContainText('분성중학교');
    await expect(page.getByText('장유고등학교')).toHaveCount(0);
  });

  test('본문에서 누를 수 있는 것은 마감일 칩뿐이고 링크·복사 단추가 없다', async ({ page }) => {
    await openWork(page, 1366);
    const screen = page.locator('[data-slot="work-screen"]');
    const chips = page.getByRole('group', { name: '마감일' }).getByRole('button');
    await expect(chips).toHaveCount(5);
    await expect(screen.getByRole('button')).toHaveCount(5);
    await expect(screen.getByRole('link')).toHaveCount(0);
    await expect(screen.getByRole('textbox')).toHaveCount(0);
    // 본문 밖에서 누를 수 있는 것은 메뉴(넣을 공고가 지금 화면)·명암 전환·메뉴 접기·계정뿐이다. 오른쪽 도구 줄은 없다.
    await expect(page.getByRole('button', { name: '메뉴 접기·펴기' })).toBeVisible();
    await expect(page.getByRole('link', { name: '넣을 공고' })).toHaveAttribute(
      'aria-current',
      'page'
    );
    await expect(page.getByLabel('전역 바로가기')).toHaveCount(0);
  });
});

test('휴대폰 폭에서도 넣을 공고가 문서를 가로로 밀지 않고 메뉴는 머리 막대에서 연다', async ({
  page
}) => {
  await page.context().addCookies([
    {
      name: SESSION_COOKIE_NAME,
      value: `${OWNER_SESSION_COOKIE_PREFIX}5`,
      url: 'http://127.0.0.1'
    }
  ]);
  await page.setViewportSize({ width: VIEWPORT_WIDTH.phone, height: 812 });
  await page.goto('/work');
  await expect(page.getByRole('heading', { name: '넣을 공고', level: 1 })).toBeVisible();
  await expect(page.locator('[data-slot="workspace-header"]')).toBeVisible();
  expect(await documentOverflow(page)).toBeLessThanOrEqual(0);
});
