/**
 * @module 책임: 공고별 그림과 그 범례가 함께 쓰는 캔버스 색을 테마가 바뀔 때마다 다시 읽는다.
 *
 * 색은 브라우저에서만 안다(테마는 root 요소의 class와 `data-theme`이 나른다). 서버가 그린 첫 화면에서는 null이라 범례 표식이
 * 중립색으로 서 있다가 붙은 뒤 그림과 같은 색이 된다 — 렌더 중에 팔레트를 읽으면 hydration 불일치가 난다(2026-09-18 dev 콘솔).
 */
import { useSyncExternalStore } from 'react';

import { CHART, chartFrame } from '@/shared/lib/chart-colors';
import type { PointsPalette } from '../lib/floor-points-option';

function subscribe(onChange: () => void): () => void {
  const theme = new MutationObserver(onChange);
  theme.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
  return () => theme.disconnect();
}

// 같은 테마에서는 같은 객체를 돌려줘야 React가 다시 그리지 않는다. 테마 표식이 바뀔 때만 새로 읽는다.
let cached: { readonly key: string; readonly palette: PointsPalette } | null = null;

function snapshot(): PointsPalette {
  const root = document.documentElement;
  const key = `${root.className}|${root.dataset.theme ?? ''}`;
  if (cached?.key !== key) {
    const frame = chartFrame();
    const body = getComputedStyle(document.body);
    cached = {
      key,
      palette: { point: CHART.floorPoint, ladder: CHART.ladder, mine: CHART.own, text: frame.text, border: frame.border, surface: body.backgroundColor, ink: body.color }
    };
  }
  return cached.palette;
}

export function usePointsPalette(): PointsPalette | null {
  return useSyncExternalStore(subscribe, snapshot, () => null);
}
