/** @module 책임: 오늘 화면이 xl(시안 캔버스 폭)·lg·md 세 폭에서 표가 문서를 가로로 밀거나 nowrap 글자가 넘치지 않고
 * 렌더되는지, 마감일 묶음·D-0/D-1 상태색·탭·달력·품목 링크·사라진 cursor 복구가 fixture 그대로 동작하는지 검사한다.
 * 이 route는 RSC가 서버에서 목록과 요약 두 계약을 조회하므로 fixture 서버가 응답한다. */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { VIEWPORT_WIDTH } from './support/viewports';

const WIDTHS = [VIEWPORT_WIDTH.designCanvas, VIEWPORT_WIDTH.lg, VIEWPORT_WIDTH.md] as const;
const STALE_CURSOR = '9007199254740990';

/** fixture 표본은 오늘·내일·사흘 뒤·마감 미확인 넷이라 묶음 머리도 넷이고 행도 넷이다. */
const ROWS = 'tbody tr[data-closes]';

// 달력 칸과 탭이 고르는 축은 KST 달력일이다. 시험이 UTC 날짜를 쓰면 한국 밤에만 깨진다.
const kstToday = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());

/** 표가 그려질 때까지 기다린다. 이 화면은 서버에서 두 계약을 읽으므로 첫 페인트에 표가 없다. */
async function 표를기다린다(page: Page) {
  await expect(page.locator(ROWS)).toHaveCount(4);
}

/**
 * 밀린 상자를 수가 아니라 **이름으로** 돌려준다. `1`이라고만 하면 어느 상자가 넘쳤는지 찾으러 다시
 * 브라우저를 띄워야 하고, 그 왕복이 이 검사를 고치는 시간의 대부분이었다.
 */
async function overflowReport(page: Page) {
  return page.evaluate(() => {
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
    // 표 안에 가로 스크롤 컨테이너를 두지 않는다. 잘린 desktop 표를 그대로 스크롤시키지 않는다(screen-system §11).
    const scrollers = nodes.filter((node) => {
      const overflowX = getComputedStyle(node).overflowX;
      return (overflowX === 'auto' || overflowX === 'scroll') && node.scrollWidth > node.clientWidth + 1;
    }).map(describe);
    return { overflow, wrapped, scrollers, bodyWidth: document.documentElement.scrollWidth, viewportWidth: window.innerWidth };
  });
}

test.describe('오늘 화면 폭별 밀림', () => {
  for (const width of WIDTHS) {
    test(`${width}px 열린 공고 표가 문서를 가로로 밀거나 nowrap 글자가 넘치지 않는다`, async ({ page }) => {
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
  test('순번 열 머리글은 화면에 없어도 이름으로 읽히고 열 폭은 그대로다', async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: VIEWPORT_WIDTH.designCanvas, height: 1200 });
    await page.goto('/today');
    await 표를기다린다(page);

    // 이름 없는 `th`는 그 열이 무엇인지 말하지 않는다. 브라우저가 계산한 이름으로 확인한다.
    const rank = page.getByRole('columnheader', { name: '순번', exact: true });
    await expect(rank).toHaveCount(1);
    // 감춘 것은 `th`가 아니라 안쪽 문구다. `th`가 표 흐름을 벗어나면 열 상자가 사라진다.
    const headerBox = await rank.boundingBox();
    const cellBox = await page.locator(ROWS).first().locator('td').first().boundingBox();
    expect(headerBox!.width).toBeCloseTo(cellBox!.width, 0);

    // 묶음 머리는 그 아래 행 전체를 덮는 `colgroup` 머리칸이라 여섯 칸을 한 칸으로 잇는다.
    await expect(page.locator('tbody th[scope="colgroup"]')).toHaveCount(4);
  });
});

test.describe('오늘 화면 fixture', () => {
  test('마감일로 묶고 오늘 묶음에만 빨강, 내일 묶음에 amber를 건다', async ({ page }) => {
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
    // 상태 색은 묶음 머리에만 붙는다. 행마다 칠하면 같은 날 스무 행이 통째로 빨개져 임박이 상태가
    // 아니라 배경이 된다. 셀을 지정하지 않고 색만 고르면 다른 칸이 같은 색을 쓰기 시작한 날 이 검사가
    // 무엇을 보는지 모르는 채로 깨진다(2026-09-11 제한지역 미관측 배지).
    await expect(page.locator('tbody [data-slot="closes"].text-destructive')).toHaveCount(1);
    await expect(page.locator('tbody [data-slot="closes"].text-pushed')).toHaveCount(1);
    await expect(page.locator('tbody .text-destructive, tbody .text-pushed')).toHaveCount(2);
    await expect(page.locator('[data-slot="today-screen"]')).not.toContainText('NaN');
    await expect(page.getByText('마감 미확인')).toBeVisible();
    await expect(page.getByText('기관 미확인')).toBeVisible();
    await expect(page.getByText('열린 공고 스냅샷 build 601', { exact: false })).toBeVisible();
  });

  test('탭은 진행중 전체와 오늘 마감을 세고 못 센 게시일은 0이 아니라 물음표다', async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: VIEWPORT_WIDTH.designCanvas, height: 1200 });
    await page.goto('/today');
    await 표를기다린다(page);

    await expect(page.getByRole('link', { name: '진행중 4' })).toBeVisible();
    // fixture는 게시일을 한 건도 관측하지 못한 build라 `?`다. 0으로 적으면 "오늘 뜬 게 없다"는
    // 다른 사실을 말하게 된다(AGENTS 3).
    await expect(page.getByRole('link', { name: '오늘 열린 ?' })).toBeVisible();
    await expect(page.getByRole('link', { name: '오늘 마감 1' })).toBeVisible();
    await expect(page.getByText('게시일 미관측 4건')).toBeVisible();
    // 축 줄의 건수는 목록이 끊기기 전의 전체 수다.
    await expect(page.getByText('4건', { exact: true })).toBeVisible();
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

  test('품목 링크를 누르면 주소만 바뀌고 그 조각이 든 행만 남으며 조건 해제로 돌아온다', async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: VIEWPORT_WIDTH.designCanvas, height: 1200 });
    await page.goto('/today?closesWithinHours=168');
    await expect(page.locator(ROWS)).toHaveCount(3);
    // next dev는 처음 여는 주소를 그 자리에서 compile하므로 이동 완료를 기본 5초보다 길게 기다린다.
    await page.getByRole('link', { name: '축산', exact: true }).first().click();
    await page.waitForURL(/items=%EC%B6%95%EC%82%B0/, { timeout: 60_000 });
    await expect(page).toHaveURL(/closesWithinHours=168/);
    await expect(page.locator(ROWS)).toHaveCount(1);

    // 켜진 축은 이름과 값을 한 버튼에 담고 누르면 해제한다.
    await page.getByRole('link', { name: '품목 조건 해제' }).click();
    await page.waitForURL((url) => !url.search.includes('items='), { timeout: 60_000 });
    await expect(page).toHaveURL(/closesWithinHours=168/);
    await expect(page.locator(ROWS)).toHaveCount(3);
  });

  test('조건에 맞는 공고가 없으면 조건을 문장으로 되풀이하고 표를 그리지 않는다', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto(`/today?items=${encodeURIComponent('없는 품목')}`);
    await expect(page.getByText('품목 없는 품목 조건에서 열린 공고가 없습니다.')).toBeVisible();
    await expect(page.locator('table')).toHaveCount(0);
    await expect(page.getByRole('link', { name: '조건 모두 해제' })).toBeVisible();
  });

  test('사라진 cursor는 처음부터 다시 조회하고 그 사실을 말한다', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto(`/today?cursor=${STALE_CURSOR}`);
    await 표를기다린다(page);
    await expect(page.getByText('목록이 갱신되어 처음부터 다시 보입니다.')).toBeVisible();
  });
});
