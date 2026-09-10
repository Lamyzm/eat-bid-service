import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import { atLeastQuery, belowQuery, BREAKPOINT_PX } from './breakpoints';

// CSS를 파싱하지 않고 `--breakpoint-<이름>: <숫자>px` 줄만 뽑는다. 목적은 두 원천의 drift 검출이다.
const themeSource = readFileSync(new URL('../../styles/tokens/breakpoints.css', import.meta.url), 'utf8');
const cssBreakpointPx = Object.fromEntries(
  [...themeSource.matchAll(/--breakpoint-([a-z0-9]+):\s*(\d+)px/g)].map(([, name, px]) => [name, Number(px)])
);

describe('화면 폭 경계의 원천 일치', () => {
  test('CSS @theme의 --breakpoint-*와 TS 모듈의 BREAKPOINT_PX는 이름과 px 값이 같다', () => {
    expect(cssBreakpointPx).toEqual(BREAKPOINT_PX);
  });

  test('CSS는 Tailwind 기본 경계를 지운 뒤 우리 값만 적는다', () => {
    expect(themeSource).toMatch(/--breakpoint-\*:\s*initial/);
    expect(themeSource).toMatch(/@theme\s*\{/);
  });

  test('matchMedia 질의는 CSS와 같은 px 경계에서 갈라진다', () => {
    expect(atLeastQuery('xl')).toBe(`(min-width: ${cssBreakpointPx.xl}px)`);
    expect(belowQuery('md')).toBe(`(max-width: ${cssBreakpointPx.md - 1}px)`);
  });
});
