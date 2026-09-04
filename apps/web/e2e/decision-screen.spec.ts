/** @module 책임: 결정 화면이 데스크톱 네 폭 × 진행 중·개찰 완료 두 상태에서 요소가 겹치거나 nowrap 글자가
 * 밀리지 않고 렌더되는지 검사한다. 이 route는 RSC가 서버에서 계약을 조회하므로 브라우저 `page.route`
 * 가로채기가 닿지 않는다. 대신 fixture 서버에 등록된 공고 id를 그대로 연다. */
import { expect, test } from '@playwright/test';

// fixture 서버가 요청 시각 기준 상대 오프셋으로 매번 다시 계산해 주는 공고 id들이다.
const OPEN_AUCTION_ID = '5796468';
const CLOSED_AUCTION_ID = '5780681';
const WIDTHS = [1440, 1280, 1024, 768] as const;
const SCENARIOS = [
  { label: '진행 중', auctionId: OPEN_AUCTION_ID, waitText: '이 공고가 열려 있습니다' },
  { label: '개찰 완료', auctionId: CLOSED_AUCTION_ID, waitText: '개찰이 끝났습니다' }
] as const;

test.describe('결정 화면 폭별 밀림', () => {
  for (const width of WIDTHS) {
    for (const scenario of SCENARIOS) {
      test(`${width}px ${scenario.label} 공고에서 nowrap 글자가 줄바꿈되거나 넘치지 않는다`, async ({ page }) => {
        // next dev의 첫 요청은 route를 그 자리에서 compile하므로 기본 30초를 가끔 넘긴다. 넉넉히 늘린다.
        test.setTimeout(90_000);
        await page.setViewportSize({ width, height: 1200 });
        await page.goto(`/auctions/${scenario.auctionId}`);
        await page.getByText(scenario.waitText).waitFor();

        const report = await page.evaluate(() => {
          const nodes = [...document.querySelectorAll('[data-slot="decision-screen"] *')];
          const overflow = nodes.filter((node) => node.scrollWidth > node.clientWidth + 1).length;
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

        expect(report.overflow).toBe(0);
        expect(report.wrapped).toBe(0);
        expect(report.bodyWidth).toBeLessThanOrEqual(width);
      });
    }
  }
});
