/** @module 책임: 결정 화면이 데스크톱 네 폭 × 진행 중·개찰 완료 두 상태에서 요소가 겹치거나 nowrap 글자가
 * 밀리지 않고 렌더되는지 검사하고, 기관 회차 이력 fixture(namsan-attempts.json)로 흐름 차트·과거 회차
 * 표·손잡이 상호작용이 실데이터 모양 그대로 그려지는지 검사한다. 이 route는 RSC가 서버에서 계약을
 * 조회하므로 브라우저 `page.route` 가로채기가 닿지 않는다. 대신 fixture 서버에 등록된 공고 id를 그대로 연다. */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// fixture 서버가 요청 시각 기준 상대 오프셋으로 매번 다시 계산해 주는 공고 id들이다.
const OPEN_AUCTION_ID = '5796468';
const CLOSED_AUCTION_ID = '5780681';
// 긴 기관명 + 쉼표로 이어진 7개 품목 라벨. 운영에서 768폭 헤더 칩 줄을 75px 넘기게 한 재료다(EAT-82).
const LONG_HEADER_AUCTION_ID = '5796470';
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
    // 문서 전체 폭은 결정 화면 slot 밖(셸·헤더 칩 줄)이 밀어도 함께 늘어난다. slot 안 노드만 세면 헤더 칩 줄처럼
    // 자기 컨테이너는 넘치지 않으면서 문서를 미는 경우를 놓친다(EAT-82). viewport는 setViewportSize 값이 아니라
    // 브라우저가 실제로 잡은 innerWidth와 비교한다.
    return { overflow, wrapped, bodyWidth: document.documentElement.scrollWidth, viewportWidth: window.innerWidth };
  });
}

// 문서 가로 스크롤 금지는 slot 검사와 별개로 페이지 전체에 거는 조건이다.
function expectDocumentFits(report: Awaited<ReturnType<typeof overflowReport>>, width: number) {
  expect(report.viewportWidth).toBe(width);
  expect(report.bodyWidth).toBeLessThanOrEqual(report.viewportWidth);
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
        expectDocumentFits(report, width);
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
      expectDocumentFits(report, width);
    });
  }

  // 남산초 fixture는 제목·품목이 짧아 헤더 칩 줄이 넘치는 경우를 재현하지 못했다. 운영에서 관측된 긴 기관명과
  // 여러 품목 라벨로 헤더가 문서를 밀지 않는지 네 폭 모두에서 본다.
  for (const width of WIDTHS) {
    test(`${width}px 긴 기관명·여러 품목 공고에서 헤더 칩 줄이 문서를 가로로 밀지 않는다`, async ({ page }) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width, height: 1200 });
      await page.goto(`/auctions/${LONG_HEADER_AUCTION_ID}`);
      await page.getByText('이 공고가 열려 있습니다').waitFor();
      await page.getByText('전국 · 값마다 낙찰된 횟수').waitFor();

      const header = page.locator('[data-slot="decision-screen"] > header');
      await expect(header.getByText('농산물 외 6')).toBeVisible();
      await expect(header.getByText('12개월')).toBeVisible();

      const report = await overflowReport(page);
      expect(report.overflow).toBe(0);
      expect(report.wrapped).toBe(0);
      expectDocumentFits(report, width);
    });
  }

  test('768px 크게 보기 히트맵은 페이지를 밀지 않고 자기 안에서만 가로 스크롤한다', async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 768, height: 1200 });
    await page.goto(`/auctions/${OPEN_AUCTION_ID}?expand=true`);
    await page.getByText('달마다 값이 몰린 자리. 진할수록 낙찰 횟수가 많습니다.').waitFor();

    const report = await overflowReport(page);
    expect(report.overflow).toBe(0);
    expectDocumentFits(report, 768);
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
    // 헤더 칩도 `하한율 90.000`을 그리므로 각주 문단으로 좁혀 본다. 각주 문구 자체는 그대로다.
    const footnote = page.locator('p', { hasText: /^전국 · 품목 전체 · 하한율 90\.000 · / });
    await expect(footnote).toBeVisible();
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
    // 시안(상세 1440 · 흐름 탭)의 2등 점선·명단 막대 띠·KST 달 라벨이 실데이터 모양 fixture로 함께 그려진다(EAT-89).
    await expect(chart.locator('g[data-series="list-count"] rect').first()).toBeAttached();
    await expect(chart.locator('g[data-axis="month"] text').first()).toHaveText(/^\d{2}-\d{2}$/);
    await expect(chart).toContainText('명단');
    // 그날 하한은 투찰률 축이라 사정률 창의 계열도 범례도 아니며 각주가 그 이유를 말한다(PDR-0004).
    await expect(page.getByRole('button', { name: '그날 하한' })).toHaveCount(0);
    await expect(page.locator('[data-slot="flow-day-floor-note"]')).toContainText('기초금액(투찰률)');
    // 범례는 토글이다. 시안대로 2등은 꺼진 채 시작하고, 켜면 점선 계열이 차트에 붙으며 주소는 그대로다.
    const runnerUpToggle = page.getByRole('button', { name: '2등' });
    await expect(runnerUpToggle).toHaveAttribute('aria-pressed', 'false');
    await expect(chart.locator('g[data-series="runner-up"]')).toHaveCount(0);
    await runnerUpToggle.click();
    await expect(runnerUpToggle).toHaveAttribute('aria-pressed', 'true');
    await expect(chart.locator('g[data-series="runner-up"] circle').first()).toBeAttached();
    await expect(page).not.toHaveURL(/runnerUp|series/);
    await runnerUpToggle.click();
    await expect(chart.locator('g[data-series="runner-up"]')).toHaveCount(0);

    await expect(page.locator('table tbody tr')).toHaveCount(12);
    // 손잡이는 값 없이 시작한다. 시작값이 있으면 표 머리글까지 번지는 추천값이 된다(AGENTS 8, EAT-84).
    await expect(page.locator('table thead th').last()).toHaveText('값을 넣으면 계산');
    await expect(page.getByRole('textbox', { name: '투찰률', exact: true })).toHaveValue('');
    await expect(page.getByRole('button', { name: '투찰률 0.001 올리기' })).toBeDisabled();
    await expect(page.locator('[data-slot="decision-screen"]')).not.toContainText('썼다면');

    // 부제의 표시 회차 수는 서버 컴포넌트가 센다. 상한 상수를 'use client' 모듈에서 읽으면 서버 쪽에서
    // 숫자가 아니게 되어 NaN이 렌더된다(EAT-77). 단위 테스트는 RSC 경계를 재현하지 못하므로 실제
    // 브라우저에서 화면 전체에 NaN이 없는지 함께 본다.
    await expect(page.locator('section[aria-label="과거 회차"]').getByText(/^\d+회 · 최근 \d+회 표시$/)).toBeVisible();
    await expect(page.locator('[data-slot="decision-screen"]')).not.toContainText('NaN');

    await expect(page.getByText('이 값이면', { exact: true })).toBeVisible();
    await expect(page.getByText('투찰률을 넣으면 지난 회차와 견줍니다')).toBeVisible();
  });

  // 1280에서 근거 열은 사이드바·rail을 뺀 636px인데 8열 표는 이보다 넓다. 표가 컨테이너 안에서만 움직여도
  // 마지막 판정 열이 화면 밖에 있으면 "열이 사라졌다"로 읽히므로, 첫·마지막 열은 고정돼 항상 보이고 덮인
  // 열이 있음을 그림자 힌트로 알려야 한다(EAT-86).
  test('1280px에서 과거 회차 표의 판정 열이 잘리지 않고 보이며 넘친 쪽에 스크롤 힌트가 있다', async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1280, height: 1200 });
    await page.goto(`/auctions/${OPEN_AUCTION_ID}${FLOW_VIEW_QUERY}`);
    await page.getByText('이 공고가 열려 있습니다').waitFor();

    const section = page.locator('section[aria-label="과거 회차"]');
    const scroller = section.locator('table').locator('..');
    const headerLast = section.locator('table thead th').last();
    // 손잡이가 비어 있으면 머리글은 안내 문구다(EAT-84). 이 테스트는 열 배치만 본다.
    await expect(headerLast).toHaveText('값을 넣으면 계산');
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
    expectDocumentFits(report, 1280);
  });

  test('투찰률을 직접 넣은 뒤 손잡이를 누르면 표 마지막 열 헤더와 이 값이면 값이 함께 바뀌고 주소에 남는다', async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 1200 });
    await page.goto(`/auctions/${OPEN_AUCTION_ID}${FLOW_VIEW_QUERY}`);
    await page.getByText('이 공고가 열려 있습니다').waitFor();

    const headerLast = page.locator('table thead th').last();
    await expect(headerLast).toHaveText('값을 넣으면 계산');

    const input = page.getByRole('textbox', { name: '투찰률', exact: true });
    await input.fill('90.000');
    await input.blur();
    await expect(headerLast).toHaveText('90.000 썼다면');
    await expect(page.getByText(/지난 \d+회 중 낙찰값 이하였을 회차/)).toBeVisible();
    const rehearsalPanel = page.getByText('이 값이면', { exact: true }).locator('..');
    const before = await rehearsalPanel.innerText();

    await page.getByRole('button', { name: '투찰률 0.001 올리기' }).click();

    await expect(headerLast).toHaveText('90.001 썼다면');
    expect(await rehearsalPanel.innerText()).not.toBe(before);

    // 놓은 값은 세션 동안 주소에 남아 새로 고쳐도 같은 값으로 그려진다(EAT-84).
    await expect(page).toHaveURL(/rate=90\.001/);
    await page.reload();
    await page.getByText('이 공고가 열려 있습니다').waitFor();
    await expect(page.locator('table thead th').last()).toHaveText('90.001 썼다면');
    await expect(page.getByRole('textbox', { name: '투찰률', exact: true })).toHaveValue('90.001');
  });

  test('흐름 차트는 레일의 투찰률을 사정률 눈금에 긋지 않고 사정률로 놓은 내 값만 긋는다', async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 1200 });
    await page.goto(`/auctions/${OPEN_AUCTION_ID}${FLOW_VIEW_QUERY}`);
    await page.getByText('이 공고가 열려 있습니다').waitFor();

    // 손잡이는 분모가 기초금액이라 사정률 눈금 위의 선이 될 수 없고, 비어 있으면 각주에 값도 없다(PDR-0004, EAT-84).
    await expect(page.locator('line[data-series="my-rate"]')).toHaveCount(0);
    await expect(page.getByText(/레일의 투찰률은 분모가 기초금액이라 사정률 눈금에 놓지 않습니다/)).toBeVisible();

    await page.goto(`/auctions/${OPEN_AUCTION_ID}${FLOW_VIEW_QUERY}&myRate=90.030`);
    await page.getByText('이 공고가 열려 있습니다').waitFor();
    await expect(page.locator('figure svg').getByText('내 값 90.030')).toBeVisible();

    // 창 밖 내 값은 경계에 붙이면 창 끝값에 놓은 것처럼 읽히므로 선 없이 방향과 "범위 밖"만 쓴다(EAT-80 후속).
    await page.goto(`/auctions/${OPEN_AUCTION_ID}${FLOW_VIEW_QUERY}&myRate=90.812`);
    await page.getByText('이 공고가 열려 있습니다').waitFor();
    await expect(page.locator('line[data-series="my-rate"]')).toHaveCount(0);
    await expect(page.locator('[data-slot="flow-my-rate-outside"]')).toContainText('내 값 90.812 ▲ 범위 밖');
  });

  // 시안 `상세 1440 · 실데이터 창원 남산초`(펼침 상태)·spec C-15의 rail 하단 두 요소다(EAT-87).
  test('레일에 낙찰값 바로 위 0.1 안에 행이 있고 이 학교와 내 기록 더 보기를 펼치면 기관 요약이 넘침 없이 보인다', async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 1200 });
    await page.goto(`/auctions/${OPEN_AUCTION_ID}${FLOW_VIEW_QUERY}`);
    await page.getByText('이 공고가 열려 있습니다').waitFor();

    const rail = page.locator('aside[aria-label="투찰"]');
    // 손잡이가 비어 있으면 이 행도 세지 않는다(EAT-84). 기관 요약은 값과 무관하므로 접힌 채 이미 있다.
    await expect(rail.getByText('낙찰값 바로 위 0.1 안에')).toHaveCount(0);
    const toggle = rail.getByRole('button', { name: '이 학교와 내 기록 더 보기' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(rail.getByText('누적 회차')).toBeHidden();

    const input = page.getByRole('textbox', { name: '투찰률', exact: true });
    await input.fill('90.000');
    await input.blur();
    await expect(rail.getByText('낙찰값 바로 위 0.1 안에')).toBeVisible();
    await expect(rail.getByText('낙찰값 이하 중 0.1%p 안')).toBeVisible();

    await toggle.click();
    await expect(rail.getByRole('button', { name: '접기' })).toHaveAttribute('aria-expanded', 'true');
    await expect(rail.getByText('누적 회차')).toBeVisible();
    await expect(rail.getByText('최근 낙찰')).toBeVisible();
    await expect(rail.getByText('발주 주기')).toBeVisible();
    await expect(rail.getByText(/보통 \d+일/)).toBeVisible();
    await expect(rail.getByText('사업자 인증 뒤에 붙습니다')).toBeVisible();
    await expect(rail.getByText('기록 없음').first()).toBeVisible();
    await expect(page.locator('[data-slot="decision-screen"]')).not.toContainText('NaN');

    // 펼친 rail의 부제·값은 nowrap이라 340px 안에서 밀리면 e2e 폭 검사가 잡아야 한다.
    const report = await overflowReport(page);
    expect(report.overflow).toBe(0);
    expect(report.wrapped).toBe(0);
    expectDocumentFits(report, 1440);
  });
});
