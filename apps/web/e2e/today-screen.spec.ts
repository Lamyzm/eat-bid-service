/** @module 책임: 오늘 화면이 2xl·xl(기둥이 옆에 붙는 가장 좁은 폭이자 시안 캔버스 폭)·lg·md 네 폭에서 카드 목록이 문서를 가로로 밀거나 nowrap 글자가 넘치지 않고
 * 렌더되는지, 마감 시각 묶음·D-0/D-1 상태색·머리 문장·달력·품목 링크·사라진 cursor 복구가 fixture 그대로 동작하는지 검사한다.
 * 이 route는 RSC가 서버에서 목록과 요약 두 계약을 조회하므로 fixture 서버가 응답한다. */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { VIEWPORT_WIDTH } from './support/viewports';

const WIDTHS = [VIEWPORT_WIDTH.xxl, VIEWPORT_WIDTH.designCanvas, VIEWPORT_WIDTH.lg, VIEWPORT_WIDTH.md] as const;
const STALE_CURSOR = '9007199254740990';

/** fixture 표본은 오늘·내일·사흘 뒤·마감 미확인 넷이라 묶음 머리도 넷이고 행도 넷이다. */
const ROWS = '[data-slot="auction-row"][data-closes]';

// 달력 칸과 탭이 고르는 축은 KST 달력일이다. 시험이 UTC 날짜를 쓰면 한국 밤에만 깨진다.
const kstToday = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());

/** 목록이 그려질 때까지 기다린다. 이 화면은 서버에서 두 계약을 읽으므로 첫 페인트에 목록이 없다. */
async function 표를기다린다(page: Page) {
  await expect(page.locator(ROWS)).toHaveCount(4);
}

/**
 * 밀린 상자를 수가 아니라 **이름으로** 돌려준다. `1`이라고만 하면 어느 상자가 넘쳤는지 찾으러 다시
 * 브라우저를 띄워야 하고, 그 왕복이 이 검사를 고치는 시간의 대부분이었다.
 */
async function overflowReport(page: Page) {
  return page.evaluate(() => {
    // inline 상자는 `scrollWidth`·`clientWidth`가 둘 다 0이라 여유를 픽셀로 물을 수 없다. 글꼴 metric
    // 차이로 CI에서만 2px 모자라는 일은 검사가 아니라 금액 칸 폭에 여유를 두어 막는다(open-auction-cards.tsx).
    const describe = (node: Element) =>
      `${node.tagName.toLowerCase()}.${node.className.toString().split(' ').slice(0, 3).join('.')}`
      + ` (${node.scrollWidth}>${node.clientWidth}) ${node.textContent?.trim().slice(0, 24) ?? ''}`;
    // `sr-only`는 이름만 접근성 트리에 싣는 1px 잘린 상자다. 화면에 그려지지 않으므로 밀림을 물을 대상이
    // 아니고, 물으면 글자보다 좁은 상자가 늘 넘친 것으로 세어진다.
    const nodes = [...document.querySelectorAll('[data-slot="today-screen"] *')].filter(
      (node) => !node.classList.contains('sr-only')
    );
    const overflow = nodes.filter((node) => {
      if (node.scrollWidth <= node.clientWidth + 1) return false;
      const overflowX = getComputedStyle(node).overflowX;
      return overflowX !== 'auto' && overflowX !== 'scroll';
    }).map(describe);
    const wrapped = nodes.filter((node) => {
      if (node.children.length !== 0 || !node.textContent?.trim()) return false;
      if (getComputedStyle(node).whiteSpace !== 'nowrap') return false;
      const parent = node.parentElement;
      if (!parent) return false;
      const overflowsScroll = node.scrollWidth > node.clientWidth + 1;
      const overflowsParent = node.getBoundingClientRect().right > parent.getBoundingClientRect().right + 1;
      return overflowsScroll || overflowsParent;
    }).map(describe);
    // 목록 안에 가로 스크롤 컨테이너를 두지 않는다. 잘린 desktop 표를 그대로 스크롤시키지 않는다(screen-system §11).
    const scrollers = nodes.filter((node) => {
      const overflowX = getComputedStyle(node).overflowX;
      return (overflowX === 'auto' || overflowX === 'scroll') && node.scrollWidth > node.clientWidth + 1;
    }).map(describe);
    return { overflow, wrapped, scrollers, bodyWidth: document.documentElement.scrollWidth, viewportWidth: window.innerWidth };
  });
}

test.describe('오늘 화면 폭별 밀림', () => {
  for (const width of WIDTHS) {
    test(`${width}px 열린 공고 목록이 문서를 가로로 밀거나 nowrap 글자가 넘치지 않는다`, async ({ page }) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width, height: 1200 });
      await page.goto('/today');
      await 표를기다린다(page);

      const report = await overflowReport(page);
      expect(report.viewportWidth).toBe(width);
      expect(report.overflow).toEqual([]);
      expect(report.wrapped).toEqual([]);
      expect(report.scrollers).toEqual([]);
      expect(report.bodyWidth).toBeLessThanOrEqual(report.viewportWidth);
    });
  }
});

test.describe('오늘 화면 접근성 트리', () => {
  test('마감 시각 묶음은 이름 있는 구획이고 그 안에 표는 없다', async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: VIEWPORT_WIDTH.designCanvas, height: 1200 });
    await page.goto('/today');
    await 표를기다린다(page);

    // 묶음 머리가 시각·남은 시간·건수를 말하고 낭독기는 구획 이름으로 그 시각을 듣는다. fixture의 오늘 행은
    // 그날 23:59에 닫힌다(`closingDayEnd`).
    const list = page.getByRole('region', { name: '열린 공고' });
    // 보이는 글자에서 날짜를 뺐으므로 시각 구획의 이름에는 날짜가 붙는다. 다른 날 같은 시각 묶음이
    // 둘이면 이름이 같은 구획이 형제로 서서 낭독기가 어느 쪽인지 말하지 못한다.
    await expect(list.getByRole('region', { name: '오늘 오후 11시 59분 마감', exact: true })).toHaveCount(1);
    // 날짜 구획 넷과 그 안의 시각 구획 넷이다.
    await expect(list.locator('section[aria-label]')).toHaveCount(8);
    await expect(list.getByRole('region', { name: '오늘', exact: true })).toHaveCount(1);
    await expect(page.locator('table')).toHaveCount(0);
  });
});

test.describe('오늘 화면 fixture', () => {
  test('마감일로 묶고 날짜 머리가 붙어 따라오며 묶음 머리에 상태색을 쓰지 않는다', async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: VIEWPORT_WIDTH.designCanvas, height: 1200 });
    await page.goto('/today');
    await 표를기다린다(page);
    await expect(page.getByRole('heading', { name: '오늘', level: 1 })).toBeVisible();

    const rows = page.locator(ROWS);
    await expect(rows.nth(0)).toHaveAttribute('data-closes', 'today');
    await expect(rows.nth(1)).toHaveAttribute('data-closes', 'tomorrow');
    await expect(rows.nth(2)).toHaveAttribute('data-closes', 'later');
    await expect(rows.nth(3)).toHaveAttribute('data-closes', 'unknown');
    // 목록 어디에도 상태색(red·amber)이 없다. amber는 stale·부분 수집의 색이고 마감이 가까운 것은
    // 관측된 일정이다 — 오늘 마감이 0건인 날에는 묶음 머리가 전부 `내일`이라 목록이 통째로 경고판이
    // 된다(§9.2, design-judge 반려 2026-09-17). 급함은 `9시간 뒤`·`내일` 글자와 마감 순 정렬이 말한다.
    await expect(page.locator('section[aria-label="열린 공고"] .text-destructive, section[aria-label="열린 공고"] .text-pushed')).toHaveCount(0);
    // 날짜는 한 단 위의 머리가 한 번만 말하고 그 머리는 스크롤을 따라 위에 붙는다. 시각 묶음 머리에는
    // 날짜가 없다 — 하루치 서른 묶음이 같은 글자로 시작하면 날짜 경계가 안 읽힌다.
    const dayHeads = page.locator('[data-slot="closes-day"]');
    await expect(dayHeads.first()).toHaveText(/오늘/);
    await expect(dayHeads).toHaveCount(4);
    await expect(page.locator('[data-slot="closes"]').first()).toHaveText('오후 11시 59분 마감');
    const dayTopBefore = await dayHeads.first().boundingBox();
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(300);
    const dayTopAfter = await dayHeads.first().boundingBox();
    expect(dayTopBefore).not.toBeNull();
    expect(dayTopAfter).not.toBeNull();
    // 붙어 있으면 스크롤한 만큼 올라가지 않는다. 자유롭게 흐르면 600px 그대로 올라간다.
    expect(dayTopBefore!.y - dayTopAfter!.y).toBeLessThan(600);
    await expect(page.locator('[data-slot="today-screen"]')).not.toContainText('NaN');
    // 마감을 관측하지 못한 묶음은 날짜 머리 한 곳에서만 그 사실을 말한다.
    await expect(page.locator('[data-slot="closes-day"]', { hasText: '마감 미확인' })).toHaveCount(1);
    await expect(page.getByText('기관 미확인')).toBeVisible();
    await expect(page.getByText('열린 공고 스냅샷 build 601', { exact: false })).toBeVisible();
  });

  test('머리 문장은 진행중 전체와 오늘 마감을 세고 못 센 게시일은 0이 아니라 셀 수 없어요다', async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: VIEWPORT_WIDTH.designCanvas, height: 1200 });
    await page.goto('/today');
    await 표를기다린다(page);

    await expect(page.getByRole('link', { name: '진행중 4건' })).toBeVisible();
    // fixture는 게시일을 한 건도 관측하지 못한 build라 "셀 수 없어요"다. 0으로 적으면 "오늘 뜬 게 없다"는
    // 다른 사실을 말하게 된다(AGENTS 3).
    await expect(page.getByText('오늘 열린 공고는 셀 수 없어요.')).toBeVisible();
    await expect(page.getByRole('link', { name: '오늘 마감 1건' })).toBeVisible();
    await expect(page.getByText('게시일이 관측되지 않은 공고가 4건 있어요', { exact: false })).toBeVisible();
    // 축 줄은 없다(EAT-241). 전체 수 `4건`은 머리 문장의 굵은 수 하나뿐이고 `하한 N · N건`은 사용자 결정으로 뺐다.
    // 행의 `하한 90%`는 축 줄이 아니라 금액 아래 한 줄이다(U9).
    await expect(page.getByText('4건', { exact: true })).toHaveCount(1);
    await expect(page.getByText(/하한 9\d · \d+건/)).toHaveCount(0);
  });

  test('조건 기둥은 지역·품목 체크 줄에 그 축만 푼 건수를 달고 기초금액은 비어 있다', async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: VIEWPORT_WIDTH.designCanvas, height: 1200 });
    await page.goto('/today?sido=41');
    // 지역을 관측하지 못한 한 행은 시도로 좁히면 빠진다. 셋이 서면 표가 그려진 것이다.
    await expect(page.locator(ROWS)).toHaveCount(3);

    const rail = page.getByRole('complementary', { name: '내 조건' });
    // 시군구는 고른 시도 안에서 관측된 짝뿐이고, 품목은 여덟 원자가 0건까지 전부 선다.
    await expect(rail.getByRole('link', { name: '창원시 3' })).toBeVisible();
    // 합성 라벨(`육류 , 가금류`) 행도 원자마다 한 번씩 센다 — 두 행이 육류를 갖는다(EAT-230).
    await expect(rail.getByRole('link', { name: '육류 2' })).toBeVisible();
    await expect(rail.getByRole('link', { name: '우유류 0' })).toBeVisible();
    // 품목 축이 없으면 미상은 이미 보고 있으므로 링크가 아니라 수다. 지역 미상은 시도를 골랐으므로 켤 수 있는 줄이다.
    await expect(rail.getByRole('link', { name: /품목 미상/ })).toHaveCount(0);
    await expect(rail.getByText('품목 미상')).toBeVisible();
    await expect(rail.getByRole('link', { name: '지역 미상 1' })).toBeVisible();
    // 기초금액은 최소 한 칸이고 기본이 비어 있다(사용자 결정 2026-09-15).
    const amount = rail.getByLabel('기초금액');
    await expect(amount).toHaveValue('');
    await expect(amount).toHaveAttribute('placeholder', '하한 없음');
    await expect(rail.getByRole('link', { name: '기본값으로' })).toHaveCount(0);
  });

  test('달력 칸을 누르면 그날 마감만 남고 다시 누르면 풀린다', async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: VIEWPORT_WIDTH.designCanvas, height: 1200 });
    await page.goto('/today');
    await 표를기다린다(page);

    const today = kstToday();
    await page.getByRole('link', { name: `${today} 1건` }).click();
    await page.waitForURL(new RegExp(`closesOn=${today}`), { timeout: 60_000 });
    await expect(page.locator(ROWS)).toHaveCount(1);
    await expect(page.locator(ROWS).first()).toHaveAttribute('data-closes', 'today');

    await page.getByRole('link', { name: `${today} 1건` }).click();
    await page.waitForURL((url) => !url.search.includes('closesOn='), { timeout: 60_000 });
    await expect(page.locator(ROWS)).toHaveCount(4);
  });

  test('기둥의 품목 줄을 누르면 주소만 바뀌고 그 조각이 든 행만 남으며 다시 누르면 풀리고 미상을 더할 수 있다', async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: VIEWPORT_WIDTH.designCanvas, height: 1200 });
    await page.goto('/today?closesWithinHours=168');
    await expect(page.locator(ROWS)).toHaveCount(3);
    const rail = page.getByRole('complementary', { name: '내 조건' });
    // next dev는 처음 여는 주소를 그 자리에서 compile하므로 이동 완료를 기본 5초보다 길게 기다린다.
    await rail.getByRole('link', { name: '수산물 1' }).click();
    await page.waitForURL(/items=/, { timeout: 60_000 });
    await expect(page).toHaveURL(/closesWithinHours=168/);
    await expect(page.locator(ROWS)).toHaveCount(1);

    // 품목 축이 걸리면 미상은 링크가 되고, 더하면 라벨 없는 행이 함께 선다.
    await rail.getByRole('link', { name: '품목 미상 1' }).click();
    await page.waitForURL(/itemUnknown=include/, { timeout: 60_000 });
    await expect(page.locator(ROWS)).toHaveCount(2);

    // 켜진 줄을 다시 누르면 그 조각만 풀린다. 미상 포함은 품목 축이 없으면 아무 일도 하지 않는다.
    await rail.getByRole('link', { name: '수산물 1' }).click();
    await page.waitForURL((url) => !url.search.includes('items='), { timeout: 60_000 });
    await expect(page).toHaveURL(/closesWithinHours=168/);
    await expect(page.locator(ROWS)).toHaveCount(3);
  });

  test('달력 아래 검색 칸에 적으면 지금 조건 안에서 이름·번호가 든 행만 남고 탭도 같은 수를 세며 지우면 돌아온다', async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: VIEWPORT_WIDTH.designCanvas, height: 1200 });
    await page.goto('/today?closesWithinHours=168');
    await expect(page.locator(ROWS)).toHaveCount(3);

    const input = page.getByRole('searchbox', { name: '학교 이름이나 공고로 찾기' });
    await input.fill('남산');
    await input.press('Enter');
    await page.waitForURL(/q=/, { timeout: 60_000 });
    // 검색은 다른 조건을 풀지 않는다 — 기간 창이 그대로 주소에 남는다.
    await expect(page).toHaveURL(/closesWithinHours=168/);
    await expect(page.locator(ROWS)).toHaveCount(1);
    await expect(page.getByText('지금 조건 안에서 “남산” · 1건')).toBeVisible();
    // 요약도 같은 검색어를 받아 탭이 표와 같은 수를 센다.
    await expect(page.getByRole('link', { name: '진행중 1건' })).toBeVisible();
    // 공고번호는 행에서 복사 손잡이로 보인다. eaT 검색창에 붙여 넣는 값이다.
    await expect(page.getByRole('button', { name: '공고번호 복사 2026-0001' })).toBeVisible();

    await page.getByRole('link', { name: '검색 지우기' }).click();
    await page.waitForURL((url) => !url.search.includes('q='), { timeout: 60_000 });
    await expect(page).toHaveURL(/closesWithinHours=168/);
    await expect(page.locator(ROWS)).toHaveCount(3);
  });

  test('조건에 맞는 공고가 없으면 조건을 문장으로 되풀이하고 목록을 그리지 않는다', async ({ page }) => {
    test.setTimeout(90_000);
    // 어휘 밖 문자열은 계약이 거절해 loader가 버리므로 0건을 만들지 못한다. 어휘 안이되 fixture에 없는 원자로 묻는다.
    await page.goto(`/today?items=${encodeURIComponent('우유류')}`);
    await expect(page.getByText('품목 우유류 조건에서 열린 공고가 없습니다.')).toBeVisible();
    await expect(page.locator(ROWS)).toHaveCount(0);
    await expect(page.getByRole('link', { name: '조건 모두 해제' })).toBeVisible();
  });

  test('사라진 cursor는 처음부터 다시 조회하고 그 사실을 말한다', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto(`/today?cursor=${STALE_CURSOR}`);
    await 표를기다린다(page);
    await expect(page.getByText('목록이 갱신되어 처음부터 다시 보입니다.')).toBeVisible();
  });
});
