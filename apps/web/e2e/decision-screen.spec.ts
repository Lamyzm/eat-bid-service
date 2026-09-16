/** @module 책임: 결정 화면이 데스크톱 네 폭 × 진행 중·개찰 완료 두 상태에서 요소가 겹치거나 nowrap 글자가
 * 밀리지 않고 렌더되는지, 과거 회차 집중 모드와 비교집단 모달이 주소로 열리고 닫히는지 검사하고, 기관 회차 이력 fixture(namsan-attempts.json)로 흐름 차트·과거 회차
 * 표·손잡이 상호작용이 실데이터 모양 그대로 그려지는지 검사한다. 이 route는 RSC가 서버에서 계약을
 * 조회하므로 브라우저 `page.route` 가로채기가 닿지 않는다. 대신 fixture 서버에 등록된 공고 id를 그대로 연다. */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { VIEWPORT_WIDTH } from './support/viewports';

// fixture 서버가 요청 시각 기준 상대 오프셋으로 매번 다시 계산해 주는 공고 id들이다.
const OPEN_AUCTION_ID = '5796468';
const CLOSED_AUCTION_ID = '5780681';
// 긴 기관명 + 쉼표로 이어진 7개 품목 라벨. 운영에서 768폭 헤더 칩 줄을 75px 넘기게 한 재료다(EAT-82).
const LONG_HEADER_AUCTION_ID = '5796470';
const WIDTHS = [VIEWPORT_WIDTH.designCanvas, VIEWPORT_WIDTH.xl, VIEWPORT_WIDTH.lg, VIEWPORT_WIDTH.md] as const;
const SCENARIOS = [
  { label: '진행 중', auctionId: OPEN_AUCTION_ID, status: '진행 중' },
  { label: '개찰 완료', auctionId: CLOSED_AUCTION_ID, status: '개찰 완료' }
] as const;
const FLOW_VIEW_QUERY = `?view=${encodeURIComponent('흐름')}`;
// 기본 보기는 흐름이다(decisionSearchParsers.view). 분포 사다리를 보려면 주소로 그 탭을 연다.
const COHORT_VIEW_QUERY = `?view=${encodeURIComponent('비교집단')}`;

/** 헤더의 상태 배지가 서버 데이터로 그려지면 화면이 도착한 것이다. 배너 문장을 대신하는 준비 신호다(EAT-115). */
async function waitForDecision(page: Page, status?: string) {
  const badge = page.locator('[data-slot="decision-status"]');
  await badge.waitFor();
  if (status) await expect(badge).toHaveText(status);
}

/**
 * 전역 도구 줄은 route가 layout effect에서 portal로 붙이므로 서버 HTML에는 없다. 이 버튼이 보이면
 * 공고 화면이 hydration까지 끝난 것이라, 표의 기록 버튼 클릭이 조용히 삼켜지지 않는다.
 */
async function waitForDockReady(page: Page) {
  await expect(page.getByRole('button', { name: '현재 공고 정보', exact: true })).toBeVisible();
}

/**
 * 투찰 레일과 "이 값이면"은 전역 오른쪽 패널의 현재 공고 관점에 산다(workspace-dock-implementation.md).
 * 패널이 닫혀 있으면 접근성 트리에 없으므로 손잡이를 만지는 검사는 먼저 이 진입을 눌러야 한다.
 */
async function openCurrentAuctionPanel(page: Page) {
  await waitForDockReady(page);
  await page.getByRole('button', { name: '현재 공고 정보', exact: true }).click();
  await expect(page.getByRole('region', { name: '현재 공고 사실', exact: true })).toBeVisible();
}

const SCREEN_ROOT = '[data-slot="decision-screen"]';
// 현재 공고 상세와 투찰 레일은 이제 결정 화면 slot 밖의 전역 dock portal에 산다. 그 내용을 펼쳐 놓고
// 보는 폭 검사는 dock도 같은 root로 넣어야 노드별 nowrap·넘침을 실제로 본다(EAT-115).
const DOCK_ROOT = '[data-slot="responsive-dock"]';

async function overflowReport(page: Page, roots: readonly string[] = [SCREEN_ROOT]) {
  return page.evaluate((selectors) => {
    const nodes = selectors
      .flatMap((selector) => {
        const root = document.querySelector(selector);
        if (!root) throw new Error(`${selector} 자리를 찾지 못했다`);
        return [...root.querySelectorAll('*')];
      })
      // 닫힌 패널과 숨긴 관점은 상자가 없어 폭을 말할 수 없다. 열려 있는 내용만 센다.
      .filter((node) => node.getClientRects().length > 0)
      // `sr-only`는 이름만 접근성 트리에 싣는 1px 잘린 상자다. 화면에 그려지지 않으므로 밀림을 물을 대상이
      // 아니고, 물으면 글자보다 좁은 상자가 늘 넘친 것으로 세어진다.
      .filter((node) => !node.classList.contains('sr-only'));
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
    // 문서 전체 폭은 결정 화면 slot 밖(셸·헤더 칩 줄)이 밀어도 함께 늘어난다. slot 안 노드만 세면 헤더 칩 줄처럼
    // 자기 컨테이너는 넘치지 않으면서 문서를 미는 경우를 놓친다(EAT-82). viewport는 setViewportSize 값이 아니라
    // 브라우저가 실제로 잡은 innerWidth와 비교한다.
    return { overflow, wrapped, bodyWidth: document.documentElement.scrollWidth, viewportWidth: window.innerWidth };
  }, roots);
}

// 문서 가로 스크롤 금지는 slot 검사와 별개로 페이지 전체에 거는 조건이다.
function expectDocumentFits(report: Awaited<ReturnType<typeof overflowReport>>, width: number) {
  expect(report.viewportWidth).toBe(width);
  expect(report.bodyWidth).toBeLessThanOrEqual(report.viewportWidth);
}

test.describe('결정 화면 폭별 밀림', () => {
  for (const width of WIDTHS) {
    for (const scenario of SCENARIOS) {
      // 흐름 탭은 회차 이력 fixture가 그리는 캔버스·범례까지 있어야 실제로 밀리는 레이아웃을 검사한 것이 된다.
      test(`${width}px ${scenario.label} 공고 흐름 탭에서 nowrap 글자가 줄바꿈되거나 넘치지 않는다`, async ({ page }) => {
        // next dev의 첫 요청은 route를 그 자리에서 compile하므로 기본 30초를 가끔 넘긴다. 넉넉히 늘린다.
        test.setTimeout(90_000);
        await page.setViewportSize({ width, height: 1200 });
        await page.goto(`/auctions/${scenario.auctionId}${FLOW_VIEW_QUERY}`);
        await waitForDecision(page, scenario.status);
        await page.locator('[data-slot="flow-canvas"] canvas').first().waitFor();

        const report = await overflowReport(page);
        expect(report.overflow).toBe(0);
        expect(report.wrapped).toBe(0);
        expectDocumentFits(report, width);
      });
    }
  }

  // 분포 탭은 사다리 25줄과 각주 한 줄이 함께 그려져 흐름 탭과 다른 폭을 요구한다. 기본 보기는 흐름이므로
  // 이 폭 검사가 볼 화면은 주소에 명시한다.
  for (const width of WIDTHS) {
    test(`${width}px 진행 중 공고 분포 탭에서 nowrap 글자가 줄바꿈되거나 넘치지 않는다`, async ({ page }) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width, height: 1200 });
      await page.goto(`/auctions/${OPEN_AUCTION_ID}${COHORT_VIEW_QUERY}`);
      await waitForDecision(page);
      await page.getByText('전국 · 값마다 낙찰된 횟수').waitFor();

      const report = await overflowReport(page);
      expect(report.overflow).toBe(0);
      expect(report.wrapped).toBe(0);
      expectDocumentFits(report, width);
    });
  }

  // 남산초 fixture는 제목·품목이 짧아 헤더 칩 줄이 넘치는 경우를 재현하지 못했다. 운영에서 관측된 긴 기관명과
  // 여러 품목 라벨로 헤더가 문서를 밀지 않는지 네 폭 모두에서 본다.
  for (const width of WIDTHS) {
    test(`${width}px 긴 기관명·여러 품목 공고에서 헤더 칩 줄이 문서를 가로로 밀지 않는다`, async ({ page }) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width, height: 1200 });
      await page.goto(`/auctions/${LONG_HEADER_AUCTION_ID}${COHORT_VIEW_QUERY}`);
      await waitForDecision(page);
      await page.getByText('전국 · 값마다 낙찰된 횟수').waitFor();

      const header = page.locator('[data-slot="decision-screen"] > header');
      await expect(header.getByText('농산물 외 6')).toBeVisible();
      // 분석 기간은 헤더가 아니라 필터 줄이 소유한다. 헤더는 공고 사실만 들고 좁은 폭에서도 밀지 않아야 한다.
      await expect(
        page.locator('[data-slot="decision-filter-bar"]').getByRole('button', { name: '기간: 12개월' })
      ).toBeVisible();

      const report = await overflowReport(page);
      expect(report.overflow).toBe(0);
      expect(report.wrapped).toBe(0);
      expectDocumentFits(report, width);
    });
  }

});

// 모달은 body에 portal로 그려져 결정 화면 slot 밖이다. 같은 규칙(overflow-x 컨테이너 자신은 제외)으로 모달 안만 센다.
async function dialogOverflowReport(page: Page) {
  return page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) return null;
    const nodes = [dialog, ...dialog.querySelectorAll('*')];
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
      return node.scrollWidth > node.clientWidth + 1 || node.getBoundingClientRect().right > parent.getBoundingClientRect().right + 1;
    }).length;
    const box = dialog.getBoundingClientRect();
    return { overflow, wrapped, right: box.right, left: box.left, viewportWidth: window.innerWidth };
  });
}

const expandQuery = (expand: string) => `?${new URLSearchParams({ expand }).toString()}`;
// fixture 회차 60건은 2021-11~2026-08에 걸쳐 있다. 기본 12개월 조회는 그중 12건만 통과하므로 keyset
// 페이지네이션을 보려면 5년 창을 연다. 하한율·낙찰방식은 공고 조건 그대로라 응답기가 실제로 거른다.
const FIVE_YEAR_QUERY = `period=${encodeURIComponent('5년')}`;

test.describe('비교집단 크게 보기 모달', () => {
  // 모달로 여는 본문은 이제 낙찰값 분포 하나뿐이다. 세 폭 모두에서 viewport 안에 들어가고 안쪽 히트맵이 페이지를 밀지 않아야 한다.
  for (const width of [VIEWPORT_WIDTH.designCanvas, VIEWPORT_WIDTH.lg, VIEWPORT_WIDTH.md] as const) {
    test(`${width}px 비교집단 모달이 viewport 안에서 넘치지 않는다`, async ({ page }) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`/auctions/${OPEN_AUCTION_ID}${expandQuery('비교집단')}`);
      const dialog = page.getByRole('dialog');
      await dialog.waitFor();
      await dialog.getByText('달마다 값이 몰린 자리. 진할수록 낙찰 횟수가 많습니다.').waitFor();

      const report = await dialogOverflowReport(page);
      if (!report) throw new Error('모달을 찾지 못했다');
      expect(report.overflow).toBe(0);
      expect(report.wrapped).toBe(0);
      expect(report.left).toBeGreaterThanOrEqual(0);
      expect(report.right).toBeLessThanOrEqual(report.viewportWidth);
      const pageReport = await overflowReport(page);
      expectDocumentFits(pageReport, width);
    });
  }
});

test.describe('과거 회차 집중 모드', () => {
  test('크게 보기는 모달 대신 같은 본문을 키우고 ESC·뒤로 가기가 주소의 expand를 지우며 돌아온다', async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: VIEWPORT_WIDTH.designCanvas, height: 1000 });
    await page.goto(`/auctions/${OPEN_AUCTION_ID}${FLOW_VIEW_QUERY}`);
    await waitForDecision(page);

    const history = page.locator('section[aria-label="과거 회차"]');
    const evidence = page.locator('section[aria-label="근거"]');
    await history.getByRole('link', { name: '크게 보기' }).click();
    await expect(page).toHaveURL(/expand=/);
    await expect(page.locator('[data-slot="decision-screen"]')).toHaveAttribute('data-focus', 'history');
    // 모달이 아니므로 표가 전역 오른쪽 도구를 덮지 않고, 차트만 접힌다.
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(evidence).toBeHidden();
    await expect(page.getByRole('button', { name: '현재 공고 정보', exact: true })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(evidence).toBeVisible();
    await expect(page).not.toHaveURL(/expand=/);

    await history.getByRole('link', { name: '크게 보기' }).click();
    await expect(evidence).toBeHidden();
    await page.goBack();
    await expect(evidence).toBeVisible();
    await expect(page).not.toHaveURL(/expand=/);
  });

  test('12행 상한 없이 첫 페이지를 그리고 cursor로 이어 붙인 페이지는 닫아도 남는다', async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: VIEWPORT_WIDTH.designCanvas, height: 1000 });
    await page.goto(`/auctions/${OPEN_AUCTION_ID}${expandQuery('과거 회차')}&${FIVE_YEAR_QUERY}`);
    const history = page.locator('section[aria-label="과거 회차"]');
    await history.getByText('이력 끝').or(history.getByRole('link', { name: '더 불러오기' })).waitFor();

    // fixture는 한 페이지 40행이라 첫 화면 60 요청도 40행 뒤에 cursor가 붙는다.
    await expect(history.locator('tbody tr')).toHaveCount(40);
    await expect(history.getByText('표본 60회 중 40회 표시')).toBeVisible();
    // 일반 표와 같은 열이다. 확대 전용 열(기초금액·하한율·하한 아래·낙찰 − 내 값)을 따로 만들지 않고,
    // 손잡이 값이 없으면 가정 계산 열도 없다(EAT-84, EAT-115).
    await expect(history.locator('thead th')).toHaveText([
      '개찰',
      '품목',
      '낙찰률(사정률)',
      '2등가(사정률)',
      '명단'
    ]);

    // 다음 페이지는 서버가 cursor를 따라 이어 붙이고 주소(pages)에 남는다.
    await history.getByRole('link', { name: '더 불러오기' }).click();
    await expect(page).toHaveURL(/pages=2/);
    // 주소는 즉시 바뀌지만 행은 RSC 왕복(회차 두 페이지 + 분포) 뒤에 온다. next dev에서는 기본 5초를 넘길 수 있다.
    await expect(history.locator('tbody tr')).toHaveCount(60, { timeout: 30_000 });
    await expect(history.getByText('표본 60회 중 60회 표시')).toBeVisible();
    await expect(history.getByText('이력 끝')).toBeVisible();
    await expect(history.getByRole('link', { name: '더 불러오기' })).toHaveCount(0);
    await expect(history).not.toContainText('NaN');

    // 닫아도 이어 붙인 표본은 주소에 남는다. 여기서 pages를 지우면 불러온 회차와 그 선택이 함께 사라진다.
    await page.keyboard.press('Escape');
    await expect(page).not.toHaveURL(/expand=/);
    await expect(page).toHaveURL(/pages=2/);
    await expect(history.locator('tbody tr')).toHaveCount(12);
  });

  test('두 번째 페이지 회차의 실제 명단을 열고 현재 공고·기록을 오가도 그 선택이 남는다', async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: VIEWPORT_WIDTH.designCanvas, height: 1000 });
    await page.goto(`/auctions/${OPEN_AUCTION_ID}${expandQuery('과거 회차')}&${FIVE_YEAR_QUERY}&pages=2`);
    const history = page.locator('section[aria-label="과거 회차"]');
    await expect(history.locator('tbody tr')).toHaveCount(60, { timeout: 30_000 });
    await waitForDockReady(page);

    const record = page.getByRole('region', { name: '선택 회차 참여 기록', exact: true });
    // 기록 진입은 기본 button이라 Enter로도 같은 자리에 닿는다(EAT-115).
    const open = history.getByRole('button', { name: /회차 참여 기록 보기$/ }).nth(50);
    await open.focus();
    await page.keyboard.press('Enter');
    await expect(record).toBeVisible();
    // 두 번째 페이지 회차도 실제 명단 조회로 이어진다. 빈 패널이나 실패가 아니라 관측 행이 열려야 한다.
    await expect(record.getByText(/^참여 기록 /)).toBeVisible();
    await expect(record.getByText('1위 · 합성 참여업체 1').first()).toBeVisible();
    const opened = await record.locator('p').filter({ hasText: /회차 / }).textContent();
    await expect(history.locator('tbody tr[data-selected]')).toHaveCount(1);

    // 현재 공고 정보로 갔다가 기록으로 돌아와도 같은 회차를 기억한다.
    const title = await page.locator('#decision-title').textContent();
    await page.getByRole('button', { name: '현재 공고 정보', exact: true }).click();
    await expect(page.getByRole('region', { name: '현재 공고 사실', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '선택 회차 기록', exact: true }).click();
    await expect(record.locator('p').filter({ hasText: /회차 / })).toHaveText(opened!);

    // 기록 패널이 열려 있으면 Escape는 그 패널이 먼저 가져간다. 확대를 접는 것은 카드의 링크다.
    await history.getByRole('link', { name: '작게 보기' }).click();
    await expect(page).not.toHaveURL(/expand=/);
    await expect(page).toHaveURL(/pages=2/);
    await expect(record.locator('p').filter({ hasText: /회차 / })).toHaveText(opened!);
    // 선택 회차가 중앙 분석 대상을 덮지 않는다.
    await expect(page.locator('#decision-title')).toHaveText(title!);

    // 조건을 바꿔 그 회차가 조회에서 빠지면 오른쪽 기록도 함께 닫힌다.
    await page.getByRole('button', { name: /^기간:/ }).click();
    await page.getByRole('menuitem', { name: '3개월' }).click();
    await expect(record).toBeHidden();
  });

  test('확대에서 내려 본 표 위치는 접었다 다시 펴도 남는다', async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: VIEWPORT_WIDTH.designCanvas, height: 900 });
    await page.goto(`/auctions/${OPEN_AUCTION_ID}${expandQuery('과거 회차')}&${FIVE_YEAR_QUERY}&pages=2`);
    const history = page.locator('section[aria-label="과거 회차"]');
    await expect(history.locator('tbody tr')).toHaveCount(60, { timeout: 30_000 });
    await waitForDockReady(page);

    // 확대에서는 표만 안에서 스크롤한다. 문서가 대신 움직이면 이 검사가 성립하지 않는다.
    const scroller = history.locator('[data-slot="history-table-scroll"]');
    await expect
      .poll(async () => scroller.evaluate((node) => node.scrollHeight > node.clientHeight + 1))
      .toBe(true);
    await scroller.evaluate((node) => node.scrollTo({ top: 600 }));
    await expect.poll(async () => scroller.evaluate((node) => node.scrollTop)).toBeGreaterThan(500);

    // 접으면 12행만 남아 브라우저가 scrollTop을 0으로 자른다. 다시 펴면 보던 자리로 돌아와야 한다.
    await history.getByRole('link', { name: '작게 보기' }).click();
    await expect(history.locator('tbody tr')).toHaveCount(12);
    await history.getByRole('link', { name: '크게 보기' }).click();
    await expect(history.locator('tbody tr')).toHaveCount(60, { timeout: 30_000 });
    await expect.poll(async () => scroller.evaluate((node) => node.scrollTop)).toBeGreaterThan(500);
  });

  // 창이 낮으면 집중 모드가 뷰포트 높이를 강제하지 않는다. 강제하면 문서와 표가 함께 세로로 스크롤해
  // 같은 화면에 스크롤 소유자가 둘이 된다(EAT-115).
  for (const viewport of [{ width: VIEWPORT_WIDTH.lg, height: 600 }, { width: VIEWPORT_WIDTH.sm, height: 480 }] as const) {
    test(`${viewport.width}×${viewport.height}에서는 확대가 문서 흐름으로 읽히고 표가 따로 스크롤하지 않는다`, async ({ page }) => {
      test.setTimeout(90_000);
      await page.setViewportSize(viewport);
      await page.goto(`/auctions/${OPEN_AUCTION_ID}${expandQuery('과거 회차')}&${FIVE_YEAR_QUERY}`);
      const history = page.locator('section[aria-label="과거 회차"]');
      await expect(history.locator('tbody tr')).toHaveCount(40);

      // 세로 스크롤 소유자는 문서 하나다. 표까지 안에서 스크롤하면 같은 화면에 스크롤이 둘이 된다.
      const scroller = history.locator('[data-slot="history-table-scroll"]');
      expect(await scroller.evaluate((node) => node.scrollHeight > node.clientHeight + 1)).toBe(false);
      expect(
        await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight + 1)
      ).toBe(true);
      // 뷰포트 높이를 강제하지 않으므로 본문이 잘리지 않는다.
      expect(
        await page.locator('[data-slot="decision-screen"]').evaluate((node) => getComputedStyle(node).height)
      ).not.toBe(`${await page.evaluate(() => window.innerHeight)}px`);

      // 접기 링크와 페이지 진입은 문서 안에 남아 스크롤로 닿을 수 있어야 한다.
      await expect(history.getByRole('link', { name: '작게 보기' })).toBeAttached();
      await expect(history.getByRole('link', { name: '더 불러오기' })).toBeAttached();
      const report = await overflowReport(page);
      expectDocumentFits(report, viewport.width);
    });
  }
});

test.describe('결정 화면 호가창 fixture', () => {
  test('남산초 실관측 코호트가 사다리 25줄과 요약·각주로 그려진다', async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: VIEWPORT_WIDTH.designCanvas, height: 1200 });
    await page.goto(`/auctions/${OPEN_AUCTION_ID}${COHORT_VIEW_QUERY}`);
    await waitForDecision(page);

    const ladder = page.locator('table', { has: page.getByText('전국 · 값마다 낙찰된 횟수') });
    await expect(ladder.locator('tbody tr')).toHaveCount(25);
    await expect(ladder.getByRole('rowheader', { name: '90.000' })).toBeVisible();
    await expect(page.getByText('전체의 24%')).toBeVisible();
    await expect(page.getByText('90.030 ~ 90.040')).toBeVisible();
    // 헤더 칩도 `하한율 90.000`을 그리므로 각주 문단으로 좁혀 본다. 각주 문구 자체는 그대로다.
    const footnote = page.locator('p', { hasText: /^전국 · 품목 전체 · 하한율 90\.000 · / });
    await expect(footnote).toBeVisible();
    // 기본값이 없으므로 처음에는 어떤 줄도 관통되지 않는다(PDR-0004).
    await expect(page.locator('tr[aria-current="true"]')).toHaveCount(0);
  });

  test('내 값을 놓으면 그 줄이 관통되고 낮게·위·같은 칸 수가 보인다', async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: VIEWPORT_WIDTH.designCanvas, height: 1200 });
    await page.goto(`/auctions/${OPEN_AUCTION_ID}${COHORT_VIEW_QUERY}`);
    await waitForDecision(page);

    await page.getByLabel('내 값(사정률)').fill('90.030');
    await page.getByRole('link', { name: '사다리에 놓기' }).click();

    await expect(page.locator('tr[aria-current="true"]')).toHaveCount(1);
    await expect(page.getByText('내 값 90.030')).toBeVisible();
    await expect(page.getByText(/낮게 낙찰 36/)).toBeVisible();
    await expect(page.getByText(/같은 칸 8/)).toBeVisible();
  });
});

test.describe('현재 공고 요약과 상세 진입', () => {
  // 헤더 조각과 상세 패널의 참여 수는 계약(findAuction·회차 이력)에서만 온다. fixture 서버가 준 값이 그대로 보이고
  // 관측 없는 값은 미확인이라고 말하는지 실제 브라우저에서 본다(EAT-90, EAT-115).
  test('본문 요약은 상태·공고 지역·마감·기초금액·하한만 읽고 나머지 수치는 이 공고 정보에서 읽는다', async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: VIEWPORT_WIDTH.designCanvas, height: 1200 });
    await page.goto(`/auctions/${OPEN_AUCTION_ID}`);
    await waitForDecision(page, '진행 중');

    const header = page.locator('[data-slot="decision-screen"] > header');
    await expect(header.getByText('검토 중인 공고')).toBeVisible();
    // eaT 공고지역이지 기관 사업장 주소가 아니다. 라벨이 그 차이를 말해야 한다(AGENTS 2·6).
    await expect(header.getByText('공고 지역 경상남도 창원시')).toBeVisible();
    await expect(header.getByText(/소재지/)).toHaveCount(0);
    await expect(header.getByText(/^마감까지 /)).toBeVisible();
    await expect(header.getByText(/^기초 [\d,]+원$/)).toBeVisible();
    await expect(header.getByText(/^하한율 \d+\.\d{3}$/)).toBeVisible();
    // 기관 발주 주기와 참여 수는 헤더가 다시 강조하지 않는다.
    await expect(header.getByText(/일마다 공고/)).toHaveCount(0);
    await expect(header.getByText(/대비 \+2/)).toHaveCount(0);

    await header.getByRole('button', { name: '이 공고 정보', exact: true }).click();
    const facts = page.getByRole('region', { name: '현재 공고 사실', exact: true });
    await expect(facts).toBeVisible();
    // 참여 행은 최신 관측 시각과 비교 관측의 실제 날짜를 함께 말한다. fixture의 두 관측은 25시간 떨어져
    // 있으므로 두 날짜가 반드시 다르고, 화면이 그 간격을 "어제"로 뭉뚱그리지 않는지 여기서 본다(EAT-115).
    const participationRow = facts.getByText('참여', { exact: true }).locator('xpath=following-sibling::dd[1]');
    const participationText = ((await participationRow.textContent()) ?? '').replaceAll(/\s+/g, ' ').trim();
    expect(participationText).toMatch(/^4곳 \d{2}-\d{2} \d{2}:\d{2} 기준 · \d{2}-\d{2} 대비 \+2$/);
    expect(participationText).not.toContain('어제');
    const [latestDate, earlierDate] = participationText.match(/\d{2}-\d{2}/g) ?? [];
    expect(earlierDate).not.toBe(latestDate);
    await expect(facts.getByText('정정')).toBeVisible();
    await expect(facts.getByText('납품')).toBeVisible();
    await expect(facts.getByText(/^\d+회$/)).toBeVisible();
    // 발주 주기 값과 그 표본 수 꼬리는 한 항목이라 같은 dd 안에 있다(AGENTS 7).
    await expect(facts.getByText(/보통 \d+일마다 공고/)).toBeVisible();
    await expect(facts.getByText(/^간격 \d+회 기준$/)).toBeVisible();
    await expect(facts.getByText(/^지난 공고 \d{2}-\d{2} · \d+일 만$/)).toBeVisible();

    // 상세는 dock 안에 있으므로 열어 둔 채 dock까지 함께 본다. 화면 slot만 보면 이 목록의 밀림을 놓친다.
    const report = await overflowReport(page, [SCREEN_ROOT, DOCK_ROOT]);
    expect(report.overflow).toBe(0);
    expect(report.wrapped).toBe(0);
    expectDocumentFits(report, VIEWPORT_WIDTH.designCanvas);
  });

  test('개찰 완료 공고는 개찰 후 지난 시간을 읽고 비교 관측이 없어 증감 없이 기준 시각만 보인다', async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: VIEWPORT_WIDTH.designCanvas, height: 1200 });
    await page.goto(`/auctions/${CLOSED_AUCTION_ID}`);
    await waitForDecision(page, '개찰 완료');

    const header = page.locator('[data-slot="decision-screen"] > header');
    await expect(header.getByText(/^개찰 후 /)).toBeVisible();

    await header.getByRole('button', { name: '이 공고 정보', exact: true }).click();
    const facts = page.getByRole('region', { name: '현재 공고 사실', exact: true });
    await expect(facts.getByText('13곳')).toBeVisible();
    await expect(facts.getByText(/^\d{2}-\d{2} \d{2}:\d{2} 기준$/)).toBeVisible();
    await expect(facts.getByText(/대비 [+-]/)).toHaveCount(0);
  });

  test('넓은 화면에서도 키보드만으로 이 공고 정보를 열고 닫으며 초점이 그 버튼으로 돌아온다', async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: VIEWPORT_WIDTH.designCanvas, height: 1000 });
    await page.goto(`/auctions/${OPEN_AUCTION_ID}${FLOW_VIEW_QUERY}`);
    await waitForDecision(page);
    await waitForDockReady(page);

    const info = page
      .locator('[data-slot="decision-screen"] > header')
      .getByRole('button', { name: '이 공고 정보', exact: true });
    // Tab만으로 닿아야 마우스 없이 쓸 수 있는 진입이다. 상한은 이 화면의 초점 이동 수보다 넉넉히 둔다.
    async function tabUntilFocused(target: typeof info, limit: number) {
      for (let step = 0; step < limit; step += 1) {
        if (await target.evaluate((node) => node === document.activeElement)) return step;
        await page.keyboard.press('Tab');
      }
      return null;
    }

    expect(await tabUntilFocused(info, 80)).not.toBeNull();
    await page.keyboard.press('Enter');
    const facts = page.getByRole('region', { name: '현재 공고 사실', exact: true });
    await expect(facts).toBeVisible();

    // 넓은 화면의 상세는 modal Sheet가 아니라 본문 옆 영역이라 Escape가 아니라 보이는 닫기 버튼이 닫는다.
    const close = page.getByRole('button', { name: '보조 패널 닫기' });
    expect(await tabUntilFocused(close, 120)).not.toBeNull();
    await page.keyboard.press('Enter');
    await expect(facts).toBeHidden();
    expect(await info.evaluate((node) => node === document.activeElement)).toBe(true);
  });

  test('좁은 화면에서는 같은 버튼이 Sheet를 열고 닫으면 초점이 버튼으로 돌아온다', async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: VIEWPORT_WIDTH.phone, height: 812 });
    await page.goto(`/auctions/${OPEN_AUCTION_ID}`);
    await waitForDecision(page);

    const button = page
      .locator('[data-slot="decision-screen"] > header')
      .getByRole('button', { name: '이 공고 정보', exact: true });
    await button.click();
    const facts = page.getByRole('region', { name: '현재 공고 사실', exact: true });
    await expect(facts).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(facts).toBeHidden();
    expect(await button.evaluate((node) => node === document.activeElement)).toBe(true);

    const report = await overflowReport(page);
    expectDocumentFits(report, VIEWPORT_WIDTH.phone);
  });
});

test.describe('결정 화면 근거 영역 fixture', () => {
  test('흐름 차트와 과거 회차 12행이 실데이터 모양 fixture로 그려진다', async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: VIEWPORT_WIDTH.designCanvas, height: 1200 });
    await page.goto(`/auctions/${OPEN_AUCTION_ID}${FLOW_VIEW_QUERY}`);
    await waitForDecision(page);

    // 차트는 Lightweight Charts 캔버스라 계열·축을 DOM으로 물을 수 없다. 캔버스가 붙었는지와 그 둘레의
    // 조작·각주만 여기서 보고, 계열 규칙 자체는 표시 모델 단위 검사가 소유한다(create-flow-chart.ts).
    const chart = page.locator('figure[aria-label="회차별 낙찰률 흐름"]');
    await expect(chart).toHaveCount(1);
    await expect(chart.locator('[data-slot="flow-canvas"] canvas').first()).toBeVisible();
    await expect(chart.getByText(/^\d+회 표시 · 조회 표본 \d+회$/)).toBeVisible();
    await expect(chart.getByText('개찰일 (KST)')).toBeVisible();
    // 그날 하한은 투찰률 축이라 사정률 창의 계열도 범례도 아니다(PDR-0004).
    await expect(page.getByRole('button', { name: '그날 하한' })).toHaveCount(0);
    // 범례는 토글이다. 시안대로 2등은 꺼진 채 시작하고, 누르면 눌림 상태만 바뀌며 주소는 그대로다.
    const runnerUpToggle = page.getByRole('button', { name: '2등' });
    await expect(runnerUpToggle).toHaveAttribute('aria-pressed', 'false');
    await runnerUpToggle.click();
    await expect(runnerUpToggle).toHaveAttribute('aria-pressed', 'true');
    await expect(page).not.toHaveURL(/runnerUp|series/);
    await runnerUpToggle.click();
    await expect(runnerUpToggle).toHaveAttribute('aria-pressed', 'false');

    // 근거 카드는 흐름·분포 두 본문을 함께 들고 꺼진 쪽을 `hidden`으로 접는다(EAT-139). 그 안의 호가창
    // 사다리도 `table`이라 페이지 전체 CSS locator는 보이지 않는 행까지 센다. 이 검사가 말하는 표는 과거 회차 하나다.
    const historyTable = page.locator('section[aria-label="과거 회차"]');
    await expect(historyTable.locator('tbody tr')).toHaveCount(12);
    // 손잡이는 값 없이 시작한다. 시작값이 있으면 표 머리글까지 번지는 추천값이 되므로 가정 계산 열 자체가 없다(AGENTS 8, EAT-84).
    await expect(historyTable.locator('thead th').last()).toHaveText('명단');
    await expect(page.locator('[data-slot="decision-screen"]')).not.toContainText(/\d\.\d{3} 기준/);

    // 부제의 표시 회차 수는 서버 컴포넌트가 센다. 상한 상수를 'use client' 모듈에서 읽으면 서버 쪽에서
    // 숫자가 아니게 되어 NaN이 렌더된다(EAT-77). 단위 테스트는 RSC 경계를 재현하지 못하므로 실제
    // 브라우저에서 화면 전체에 NaN이 없는지 함께 본다.
    await expect(page.locator('section[aria-label="과거 회차"]').getByText(/^\d+회 · 최근 \d+회 표시$/)).toBeVisible();
    await expect(page.locator('[data-slot="decision-screen"]')).not.toContainText('NaN');

    // 투찰 레일과 "이 값이면"은 전역 오른쪽 패널이 소유한다. 열어야 손잡이가 접근성 트리에 나타난다.
    await openCurrentAuctionPanel(page);
    await expect(page.getByRole('textbox', { name: '투찰률 눌러서 직접 입력', exact: true })).toHaveValue('');
    await expect(page.getByRole('button', { name: '투찰률 0.001 올리기' })).toBeDisabled();
    await expect(page.getByText('이 값이면', { exact: true })).toBeVisible();
    await expect(page.getByText('투찰률을 넣으면 지난 회차와 견줍니다')).toBeVisible();
  });

  // 1280에서 근거 열은 사이드바·rail을 뺀 636px인데 8열 표는 이보다 넓다. 표가 컨테이너 안에서만 움직여도
  // 마지막 판정 열이 화면 밖에 있으면 "열이 사라졌다"로 읽히므로, 첫·마지막 열은 고정돼 항상 보이고 덮인
  // 열이 있음을 그림자 힌트로 알려야 한다(EAT-86).
  test(`${VIEWPORT_WIDTH.xl}px에서 과거 회차 표의 판정 열이 잘리지 않고 보이며 넘친 쪽에 스크롤 힌트가 있다`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: VIEWPORT_WIDTH.xl, height: 1200 });
    // 판정 열은 손잡이 값이 있을 때만 있는 마지막 열이다. 그 열이 잘리는지 보려면 값을 놓고 열어야 한다.
    await page.goto(`/auctions/${OPEN_AUCTION_ID}${FLOW_VIEW_QUERY}&rate=90.000`);
    await waitForDecision(page);

    const section = page.locator('section[aria-label="과거 회차"]');
    const scroller = section.locator('[data-slot="history-table-scroll"]');
    const headerLast = section.locator('table thead th').last();
    await expect(headerLast).toHaveText('90.000 기준');
    await expect(headerLast).toBeVisible();

    const geometry = await scroller.evaluate((node) => ({
      overflows: node.scrollWidth > node.clientWidth + 1,
      right: node.getBoundingClientRect().right
    }));
    const lastBox = await headerLast.boundingBox();
    const firstBox = await section.locator('table thead th').first().boundingBox();
    const sectionBox = await section.boundingBox();
    if (!lastBox || !firstBox || !sectionBox) throw new Error('표 머리글 위치를 읽지 못했다');
    // 판정 열은 스크롤 위치와 무관하게 컨테이너 오른쪽 안에 통째로 들어 있어야 한다.
    expect(lastBox.x + lastBox.width).toBeLessThanOrEqual(geometry.right + 1);
    expect(lastBox.x).toBeGreaterThanOrEqual(sectionBox.x);
    // 넘치면 오른쪽 힌트가 켜지고 왼쪽 끝이라 왼쪽 힌트는 꺼진다. 넘치지 않으면 어떤 힌트도 남지 않는다.
    // 힌트는 hydration 뒤 effect가 붙이므로 SSR HTML만 보고 판정하지 않도록 auto-wait하는 expect로 본다.
    if (geometry.overflows) await expect(scroller).toHaveAttribute('data-scroll-right', '');
    else await expect(scroller).not.toHaveAttribute('data-scroll-right', '');
    await expect(scroller).not.toHaveAttribute('data-scroll-left', '');

    if (geometry.overflows) {
      await scroller.evaluate((node) => node.scrollTo({ left: node.scrollWidth }));
      await expect(scroller).toHaveAttribute('data-scroll-left', '');
      await expect(scroller).not.toHaveAttribute('data-scroll-right', '');
      // 끝까지 밀어도 첫 열(개찰)은 왼쪽에 고정돼 남는다.
      const firstAfter = await section.locator('table thead th').first().boundingBox();
      expect(firstAfter?.x).toBeCloseTo(firstBox.x, 0);
    }

    const report = await overflowReport(page);
    expect(report.overflow).toBe(0);
    expectDocumentFits(report, VIEWPORT_WIDTH.xl);
  });

  test('투찰률을 직접 넣은 뒤 손잡이를 누르면 표 마지막 열 헤더와 이 값이면 값이 함께 바뀌고 주소에 남는다', async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: VIEWPORT_WIDTH.designCanvas, height: 1200 });
    // 0.001을 올렸을 때 판정이 갈리는 회차(그날 하한 90.0010)는 fixture 35번째 행이라 5년 창에서만 표본에 든다.
    await page.goto(`/auctions/${OPEN_AUCTION_ID}${FLOW_VIEW_QUERY}&${FIVE_YEAR_QUERY}`);
    await waitForDecision(page);
    await openCurrentAuctionPanel(page);

    // 꺼진 분포 본문의 사다리도 `table`이므로 말하려는 표로 좁힌다(EAT-139).
    const headerLast = page.locator('section[aria-label="과거 회차"] thead th').last();
    await expect(headerLast).toHaveText('명단');

    const input = page.getByRole('textbox', { name: '투찰률 눌러서 직접 입력', exact: true });
    await input.fill('90.000');
    await input.blur();
    await expect(headerLast).toHaveText('90.000 기준');
    await expect(page.getByText(/지난 \d+회 중 낙찰값 이하였을 회차/)).toBeVisible();
    const rehearsalPanel = page.getByText('이 값이면', { exact: true }).locator('..');
    const before = await rehearsalPanel.innerText();

    await page.getByRole('button', { name: '투찰률 0.001 올리기' }).click();

    await expect(headerLast).toHaveText('90.001 기준');
    expect(await rehearsalPanel.innerText()).not.toBe(before);

    // 놓은 값은 세션 동안 주소에 남아 새로 고쳐도 같은 값으로 그려진다(EAT-84).
    await expect(page).toHaveURL(/rate=90\.001/);
    await page.reload();
    await waitForDecision(page);
    await expect(page.locator('section[aria-label="과거 회차"] thead th').last()).toHaveText('90.001 기준');
    await openCurrentAuctionPanel(page);
    await expect(page.getByRole('textbox', { name: '투찰률 눌러서 직접 입력', exact: true })).toHaveValue('90.001');
  });

  // 시안 `상세 1440 · 실데이터 창원 남산초`(펼침 상태)·spec C-15의 rail 하단 두 요소다(EAT-87).
  test('레일에 낙찰값 바로 위 0.1 안에 행이 있고 이 학교와 내 기록 더 보기를 펼치면 기관 요약이 넘침 없이 보인다', async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: VIEWPORT_WIDTH.designCanvas, height: 1200 });
    await page.goto(`/auctions/${OPEN_AUCTION_ID}${FLOW_VIEW_QUERY}`);
    await waitForDecision(page);
    await openCurrentAuctionPanel(page);

    // 레일은 전역 오른쪽 패널 안에 산다. 예전 route 내부 aside는 전역 배치로 옮기며 사라졌다.
    const rail = page.locator('[data-slot="responsive-dock"]');
    // 손잡이가 비어 있으면 이 행도 세지 않는다(EAT-84). 기관 요약은 값과 무관하므로 접힌 채 이미 있다.
    await expect(rail.getByText('낙찰값 바로 위 0.1 안에')).toHaveCount(0);
    const toggle = rail.getByRole('button', { name: '이 학교와 내 기록 더 보기' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    // 접힌 동안은 DOM에도 없다. 같은 패널의 현재 공고 사실에도 기관 이력 항목이 있으므로 이 펼침 영역으로 좁힌다.
    const details = page.locator('#rehearsal-organization-details');
    await expect(details).toHaveCount(0);

    const input = page.getByRole('textbox', { name: '투찰률 눌러서 직접 입력', exact: true });
    await input.fill('90.000');
    await input.blur();
    await expect(rail.getByText('낙찰값 바로 위 0.1 안에')).toBeVisible();
    await expect(rail.getByText('낙찰값 이하 중 0.1%p 안')).toBeVisible();

    await toggle.click();
    await expect(rail.getByRole('button', { name: '접기' })).toHaveAttribute('aria-expanded', 'true');
    await expect(details.getByText('누적 회차')).toBeVisible();
    await expect(details.getByText('최근 낙찰')).toBeVisible();
    await expect(details.getByText('발주 주기')).toBeVisible();
    await expect(details.getByText(/보통 \d+일/)).toBeVisible();
    await expect(details.getByText('사업자 인증 뒤에 붙습니다')).toBeVisible();
    await expect(details.getByText('기록 없음').first()).toBeVisible();
    await expect(page.locator('[data-slot="decision-screen"]')).not.toContainText('NaN');

    // 펼친 rail의 부제·값은 nowrap이라 340px 안에서 밀리면 e2e 폭 검사가 잡아야 한다. rail은 dock 안이므로
    // 그 root를 함께 넣어야 이 펼침 영역이 검사에 든다.
    const report = await overflowReport(page, [SCREEN_ROOT, DOCK_ROOT]);
    expect(report.overflow).toBe(0);
    expect(report.wrapped).toBe(0);
    expectDocumentFits(report, VIEWPORT_WIDTH.designCanvas);
  });
});

/**
 * 이름·역할·상태는 브라우저가 계산해야 사실이다. 맨 `div`·`span`에 걸린 `aria-label`이나 겹친 라벨은
 * DOM에 그대로 남아 있어 markup 검사로는 통과하므로, 실제 접근성 트리를 role과 이름으로 물어 확인한다.
 */
test.describe('결정 화면 접근성 트리', () => {
  test('조건 묶음·차트·투찰률 입력·선택 행·철회 항목이 이름과 상태로 읽힌다', async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: VIEWPORT_WIDTH.designCanvas, height: 1200 });
    await page.goto(`/auctions/${OPEN_AUCTION_ID}${FLOW_VIEW_QUERY}`);
    await waitForDecision(page);

    // 조건 줄은 landmark가 아니라 이름을 가진 조작 묶음이다.
    await expect(page.getByRole('group', { name: '분석 조건', exact: true })).toBeVisible();
    // 캔버스 자리는 이름을 가진 그림이다. 맨 div면 role이 generic이라 이 질의가 아무것도 찾지 못한다.
    await expect(page.getByRole('img', { name: /^낙찰률 차트\./ })).toBeVisible();

    // 선택 행은 배경색과 data 속성만이 아니라 상태로도 "지금 이 행"을 말한다.
    const history = page.locator('section[aria-label="과거 회차"]');
    await waitForDockReady(page);
    await history.getByRole('button', { name: /회차 참여 기록 보기$/ }).first().click();
    const record = page.getByRole('region', { name: '선택 회차 참여 기록', exact: true });
    await expect(record).toBeVisible();
    await expect(history.locator('tbody tr[aria-current="true"]')).toHaveCount(1);
    // 철회 값은 "철회 아님"·"미확인"만으로 어느 항목인지 말하지 못한다. 이름은 값 앞 문구가 싣는다.
    await expect(record.getByText('철회 여부').first()).toBeAttached();

    await openCurrentAuctionPanel(page);
    await expect(page.getByRole('textbox', { name: '투찰률 눌러서 직접 입력', exact: true })).toBeVisible();
    // 겹친 aria-label이 이기면 라벨의 둘째 줄이 이름에서 빠져 이 질의가 실패한다.
    await expect(page.getByRole('textbox', { name: '투찰률', exact: true })).toHaveCount(0);
  });
});
