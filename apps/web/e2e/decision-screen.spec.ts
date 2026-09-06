/** @module 책임: 결정 화면이 데스크톱 네 폭 × 진행 중·개찰 완료 두 상태에서 요소가 겹치거나 nowrap 글자가
 * 밀리지 않고 렌더되는지 검사하고, 기관 회차 이력 fixture(namsan-attempts.json)로 흐름 차트·과거 회차
 * 표·손잡이 상호작용이 실데이터 모양 그대로 그려지는지 검사한다. 이 route는 RSC가 서버에서 계약을
 * 조회하므로 브라우저 `page.route` 가로채기가 닿지 않는다. 대신 fixture 서버에 등록된 공고 id를 그대로 연다. */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// fixture 서버가 요청 시각 기준 상대 오프셋으로 매번 다시 계산해 주는 공고 id들이다.
const OPEN_AUCTION_ID = '5796468';
const CLOSED_AUCTION_ID = '5780681';
const WIDTHS = [1440, 1280, 1024, 768] as const;
const SCENARIOS = [
  { label: '진행 중', auctionId: OPEN_AUCTION_ID, waitText: '이 공고가 열려 있습니다' },
  { label: '개찰 완료', auctionId: CLOSED_AUCTION_ID, waitText: '개찰이 끝났습니다' }
] as const;
const FLOW_VIEW_QUERY = `?view=${encodeURIComponent('흐름')}`;

async function overflowReport(page: Page) {
  return page.evaluate(() => {
    const nodes = [...document.querySelectorAll('[data-slot="decision-screen"] *')];
    // 과거 회차 표는 `overflow-x-auto`로 자기 안에서만 가로 스크롤되도록 설계됐다(history-table.tsx).
    // 그 컨테이너 자신의 scrollWidth > clientWidth는 페이지가 밀린 게 아니라 의도한 동작이라 제외한다.
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
    return { overflow, wrapped, bodyWidth: document.documentElement.scrollWidth };
  });
}

test.describe('결정 화면 폭별 밀림', () => {
  for (const width of WIDTHS) {
    for (const scenario of SCENARIOS) {
      // 흐름 탭은 회차 이력 fixture가 그리는 svg·범례까지 있어야 실제로 밀리는 레이아웃을 검사한 것이 된다.
      test(`${width}px ${scenario.label} 공고 흐름 탭에서 nowrap 글자가 줄바꿈되거나 넘치지 않는다`, async ({ page }) => {
        // next dev의 첫 요청은 route를 그 자리에서 compile하므로 기본 30초를 가끔 넘긴다. 넉넉히 늘린다.
        test.setTimeout(90_000);
        await page.setViewportSize({ width, height: 1200 });
        await page.goto(`/auctions/${scenario.auctionId}${FLOW_VIEW_QUERY}`);
        await page.getByText(scenario.waitText).waitFor();
        await page.locator('svg[aria-label="회차별 낙찰률 흐름"]').waitFor();

        const report = await overflowReport(page);
        expect(report.overflow).toBe(0);
        expect(report.wrapped).toBe(0);
        expect(report.bodyWidth).toBeLessThanOrEqual(width);
      });
    }
  }

  // 기본 탭인 비교집단은 사다리 25줄과 각주 한 줄이 함께 그려져 흐름 탭과 다른 폭을 요구한다.
  for (const width of WIDTHS) {
    test(`${width}px 진행 중 공고 기본 탭(비교집단)에서 nowrap 글자가 줄바꿈되거나 넘치지 않는다`, async ({ page }) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width, height: 1200 });
      await page.goto(`/auctions/${OPEN_AUCTION_ID}`);
      await page.getByText('이 공고가 열려 있습니다').waitFor();
      await page.getByText('전국 · 값마다 낙찰된 횟수').waitFor();

      const report = await overflowReport(page);
      expect(report.overflow).toBe(0);
      expect(report.wrapped).toBe(0);
      expect(report.bodyWidth).toBeLessThanOrEqual(width);
    });
  }

  test('768px 크게 보기 히트맵은 페이지를 밀지 않고 자기 안에서만 가로 스크롤한다', async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 768, height: 1200 });
    await page.goto(`/auctions/${OPEN_AUCTION_ID}?expand=true`);
    await page.getByText('달마다 값이 몰린 자리. 진할수록 낙찰 횟수가 많습니다.').waitFor();

    const report = await overflowReport(page);
    expect(report.overflow).toBe(0);
    expect(report.bodyWidth).toBeLessThanOrEqual(768);
  });
});

test.describe('결정 화면 호가창 fixture', () => {
  test('남산초 실관측 코호트가 사다리 25줄과 요약·각주로 그려진다', async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 1200 });
    await page.goto(`/auctions/${OPEN_AUCTION_ID}`);
    await page.getByText('이 공고가 열려 있습니다').waitFor();

    const ladder = page.locator('table', { has: page.getByText('전국 · 값마다 낙찰된 횟수') });
    await expect(ladder.locator('tbody tr')).toHaveCount(25);
    await expect(ladder.getByRole('rowheader', { name: '90.000' })).toBeVisible();
    await expect(page.getByText('전체의 24%')).toBeVisible();
    await expect(page.getByText('90.030 ~ 90.040')).toBeVisible();
    await expect(page.getByText(/하한율 90\.000/)).toBeVisible();
    // 기본값이 없으므로 처음에는 어떤 줄도 관통되지 않는다(PDR-0004).
    await expect(page.locator('tr[aria-current="true"]')).toHaveCount(0);
  });

  test('내 값을 놓으면 그 줄이 관통되고 낮게·위·같은 칸 수가 보인다', async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 1200 });
    await page.goto(`/auctions/${OPEN_AUCTION_ID}`);
    await page.getByText('이 공고가 열려 있습니다').waitFor();

    await page.getByLabel('내 값(사정률)').fill('90.030');
    await page.getByRole('link', { name: '사다리에 놓기' }).click();

    await expect(page.locator('tr[aria-current="true"]')).toHaveCount(1);
    await expect(page.getByText('내 값 90.030')).toBeVisible();
    await expect(page.getByText(/낮게 낙찰 36/)).toBeVisible();
    await expect(page.getByText(/같은 칸 8/)).toBeVisible();
  });
});

test.describe('결정 화면 근거 영역 fixture', () => {
  test('흐름 차트와 과거 회차 12행이 실데이터 모양 fixture로 그려진다', async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 1200 });
    await page.goto(`/auctions/${OPEN_AUCTION_ID}${FLOW_VIEW_QUERY}`);
    await page.getByText('이 공고가 열려 있습니다').waitFor();

    const chart = page.locator('figure svg[aria-label="회차별 낙찰률 흐름"]');
    await expect(chart).toHaveCount(1);
    await expect(page.locator('circle[data-item="selected"]')).not.toHaveCount(0);

    await expect(page.locator('table tbody tr')).toHaveCount(12);
    await expect(page.locator('table thead th').last()).toHaveText('90.000 썼다면');

    await expect(page.getByText('이 값이면', { exact: true })).toBeVisible();
    await expect(page.getByText(/지난 \d+회 중 낙찰됐을 회차/)).toBeVisible();
  });

  test('투찰률 손잡이를 누르면 표 마지막 열 헤더와 이 값이면 값이 함께 바뀐다', async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 1200 });
    await page.goto(`/auctions/${OPEN_AUCTION_ID}${FLOW_VIEW_QUERY}`);
    await page.getByText('이 공고가 열려 있습니다').waitFor();

    const headerLast = page.locator('table thead th').last();
    await expect(headerLast).toHaveText('90.000 썼다면');
    const rehearsalPanel = page.getByText('이 값이면', { exact: true }).locator('..');
    const before = await rehearsalPanel.innerText();

    await page.getByRole('button', { name: '투찰률 0.001 올리기' }).click();

    await expect(headerLast).toHaveText('90.001 썼다면');
    expect(await rehearsalPanel.innerText()).not.toBe(before);
  });
});
