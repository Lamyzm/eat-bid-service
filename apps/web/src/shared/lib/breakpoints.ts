/**
 * @module 책임: CSS `@theme`의 `--breakpoint-*`(styles/tokens/breakpoints.css)와 같은 화면 폭 경계를 JS hook과
 * e2e viewport가 읽을 숫자 하나로 소유한다. 원천은 CSS 쪽이며 여기 값이 어긋나면 breakpoints.test.ts가 실패한다.
 */

/** Tailwind 접두사와 같은 이름의 폭 경계(px). viewport 폭이 이 값 이상이면 그 계층이다. */
export const BREAKPOINT_PX = { sm: 640, md: 768, lg: 1024, xl: 1280, '2xl': 1536 } as const;

export type BreakpointName = keyof typeof BREAKPOINT_PX;

/** CSS `@variant md`·`md:`와 같은 판정(경계 이상)을 matchMedia로 묻는 질의다. */
export function atLeastQuery(name: BreakpointName): string {
  return `(min-width: ${BREAKPOINT_PX[name]}px)`;
}

/** 경계 미만(`max-md:`와 같은 판정)을 묻는 질의다. 경계가 정수 px이므로 `경계 - 1px` 이하와 같다. */
export function belowQuery(name: BreakpointName): string {
  return `(max-width: ${BREAKPOINT_PX[name] - 1}px)`;
}
