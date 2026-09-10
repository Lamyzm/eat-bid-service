/** @module 책임: 오늘 화면이 1440·1024·768 세 폭에서 표가 문서를 가로로 밀거나 nowrap 글자가 넘치지 않고
 * 렌더되는지, 마감 임박 순·D-0/D-1 상태색·필터 링크·사라진 cursor 복구가 fixture 그대로 동작하는지 검사한다.
 * 이 route는 RSC가 서버에서 계약을 조회하므로 fixture 서버가 응답한다. */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const WIDTHS = [1440, 1024, 768] as const;
const STALE_CURSOR = '9007199254740990';

async function overflowReport(page: Page) {
  return page.evaluate(() => {
    // `sr-only`는 이름만 접근성 트리에 싣는 1px 잘린 상자다. 화면에 그려지지 않으므로 밀림을 물을 대상이
    // 아니고, 물으면 글자보다 좁은 상자가 늘 넘친 것으로 세어진다.
    const nodes = [...document.querySelectorAll('[data-slot="today-screen"] *')].filter(
      (node) => !node.classList.contains('sr-only')
    );
    const overflow = nodes.filter((node) => {
      if (node.scrollWidth <= node.clientWidth + 1) return false;
      const overflowX = getComputedStyle(node).overflowX;
      return overflowX !== 'auto' && overflowX !== 'scroll';
    }).length;
    const wrapped = nodes.filter((node) => {
      if (node.children.length !== 0 || !node.textContent?.trim()) return false;
      if (getComputedStyle(node).whiteSpace !== 'nowrap') return false;
      const parent = node.parentElement;
      if (!parent) return false;
      const overflowsScroll = node.scrollWidth > node.clientWidth + 1;
      const overflowsParent = node.getBoundingClientRect().right > parent.getBoundingClientRect().right + 1;
      return overflowsScroll || overflowsParent;
    }).length;
    // 표 안에 가로 스크롤 컨테이너를 두지 않는다. 잘린 desktop 표를 그대로 스크롤시키지 않는다(screen-system §11).
    const scrollers = nodes.filter((node) => {
      const overflowX = getComputedStyle(node).overflowX;
      return (overflowX === 'auto' || overflowX === 'scroll') && node.scrollWidth > node.clientWidth + 1;
    }).length;
    return { overflow, wrapped, scrollers, bodyWidth: document.documentElement.scrollWidth, viewportWidth: window.innerWidth };
  });
}

test.describe('오늘 화면 폭별 밀림', () => {
  for (const width of WIDTHS) {
    test(`${width}px 열린 공고 표가 문서를 가로로 밀거나 nowrap 글자가 넘치지 않는다`, async ({ page }) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width, height: 1200 });
      await page.goto('/today');
      await page.getByText('마감 임박 순').waitFor();
      await expect(page.locator('tbody tr')).toHaveCount(4);

      const report = await overflowReport(page);
      expect(report.viewportWidth).toBe(width);
      expect(report.overflow).toBe(0);
      expect(report.wrapped).toBe(0);
      expect(report.scrollers).toBe(0);
      expect(report.bodyWidth).toBeLessThanOrEqual(report.viewportWidth);
    });
  }
});

test.describe('오늘 화면 접근성 트리', () => {
  test('행동 열 머리글은 화면에 없어도 이름으로 읽히고 열 폭은 그대로다', async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 1200 });
    await page.goto('/today');
    await page.getByText('마감 임박 순').waitFor();

    // 이름 없는 `th`는 그 열이 무엇인지 말하지 않는다. 브라우저가 계산한 이름으로 확인한다.
    const open = page.getByRole('columnheader', { name: '열기', exact: true });
    await expect(open).toHaveCount(1);
    // 감춘 것은 `th`가 아니라 안쪽 문구다. `th`가 표 흐름을 벗어나면 열 상자가 사라진다.
    const headerBox = await open.boundingBox();
    const cellBox = await page.locator('tbody tr').first().locator('td').last().boundingBox();
    expect(headerBox!.width).toBeCloseTo(cellBox!.width, 0);
  });
});

test.describe('오늘 화면 fixture', () => {
  test('마감 임박 순으로 그리고 오늘 마감에만 빨강, 내일 마감에 amber를 건다', async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 1200 });
    await page.goto('/today');
    await page.getByText('마감 임박 순').waitFor();
    await expect(page.getByRole('heading', { name: '오늘', level: 1 })).toBeVisible();
    await expect(page.getByText('열린 공고 4건')).toBeVisible();

    const rows = page.locator('tbody tr');
    await expect(rows.nth(0)).toHaveAttribute('data-closes', 'today');
    await expect(rows.nth(1)).toHaveAttribute('data-closes', 'tomorrow');
    await expect(rows.nth(2)).toHaveAttribute('data-closes', 'later');
    await expect(rows.nth(3)).toHaveAttribute('data-closes', 'unknown');
    await expect(page.locator('tbody .text-destructive')).toHaveCount(1);
    await expect(page.locator('tbody .text-destructive')).toContainText('D-0');
    await expect(page.locator('tbody .text-pushed')).toContainText('D-1');
    await expect(page.locator('[data-slot="today-screen"]')).not.toContainText('NaN');
    await expect(page.getByText('마감 미확인')).toBeVisible();
    await expect(page.getByText('기관 미확인')).toBeVisible();
    await expect(page.getByText('열린 공고 스냅샷 build 601', { exact: false })).toBeVisible();
  });

  test('품목 링크를 누르면 주소만 바뀌고 그 라벨 행만 남으며 조건 해제로 돌아온다', async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 1200 });
    await page.goto('/today?closesWithinHours=168');
    await page.getByText('마감 임박 순').waitFor();
    // next dev는 처음 여는 주소를 그 자리에서 compile하므로 이동 완료를 기본 5초보다 길게 기다린다.
    await page.getByRole('link', { name: '축산', exact: true }).first().click();
    await page.waitForURL(/item=%EC%B6%95%EC%82%B0/, { timeout: 60_000 });
    await expect(page).toHaveURL(/closesWithinHours=168/);
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page.getByRole('link', { name: /품목 축산/ })).toBeVisible();

    await page.getByRole('link', { name: '오늘 안' }).click();
    await page.waitForURL(/closesWithinHours=24/, { timeout: 60_000 });
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await page.getByRole('link', { name: /품목 축산/ }).click();
    await page.waitForURL((url) => !url.search.includes('item='), { timeout: 60_000 });
    await expect(page).toHaveURL(/closesWithinHours=24/);
  });

  test('조건에 맞는 공고가 없으면 조건을 문장으로 되풀이하고 표를 그리지 않는다', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto(`/today?item=${encodeURIComponent('없는 품목')}`);
    await expect(page.getByText('품목 없는 품목 조건에서 열린 공고가 없습니다.')).toBeVisible();
    await expect(page.locator('table')).toHaveCount(0);
    await expect(page.getByRole('link', { name: '조건 모두 해제' })).toBeVisible();
  });

  test('사라진 cursor는 처음부터 다시 조회하고 그 사실을 말한다', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto(`/today?cursor=${STALE_CURSOR}`);
    await page.getByText('마감 임박 순').waitFor();
    await expect(page.getByText('목록이 갱신되어 처음부터 다시 보입니다.')).toBeVisible();
    await expect(page.locator('tbody tr')).toHaveCount(4);
  });
});
