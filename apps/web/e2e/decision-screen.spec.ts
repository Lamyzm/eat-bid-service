/** @module 책임: 결정 화면이 데스크톱 네 폭에서 요소가 겹치거나 nowrap 글자가 줄바꿈되지 않고 렌더되는지 검사한다. 이 route는 RSC가 서버에서 계약을 조회하므로 브라우저 `page.route` 가로채기가 닿지 않는다. 대신 fixture 서버에 등록된 진행 중 공고 id를 그대로 연다. */
import { expect, test } from '@playwright/test';

// fixture 서버가 요청 시각 기준 +1일(마감)·+1일 3시간(개찰)으로 매번 다시 계산해 주는 진행 중 공고다.
const OPEN_AUCTION_ID = '5796468';
const WIDTHS = [1440, 1280, 1024, 768] as const;

test.describe('결정 화면 폭별 밀림', () => {
  for (const width of WIDTHS) {
    test(`${width}px에서 nowrap 글자가 줄바꿈되거나 넘치지 않는다`, async ({ page }) => {
      // next dev의 첫 요청은 route를 그 자리에서 compile하므로 기본 30초를 가끔 넘긴다. 넉넉히 늘린다.
      test.setTimeout(90_000);
      await page.setViewportSize({ width, height: 1200 });
      await page.goto(`/auctions/${OPEN_AUCTION_ID}`);
      await page.getByText('이 공고가 열려 있습니다').waitFor();

      const report = await page.evaluate(() => {
        const nodes = [...document.querySelectorAll('[data-slot="decision-screen"] *')];
        const overflow = nodes.filter(
          (node) => node.scrollWidth > node.clientWidth + 1 && getComputedStyle(node).overflowX !== 'visible'
        ).length;
        const wrapped = nodes.filter(
          (node) =>
            node.children.length === 0 &&
            node.textContent?.trim() &&
            getComputedStyle(node).whiteSpace === 'nowrap' &&
            node.getClientRects().length > 1
        ).length;
        return { overflow, wrapped, bodyWidth: document.documentElement.scrollWidth };
      });

      expect(report.overflow).toBe(0);
      expect(report.wrapped).toBe(0);
      expect(report.bodyWidth).toBeLessThanOrEqual(width);
    });
  }
});
