/** @module 책임: reduced-motion과 View Transition 지원 여부에 맞춰 theme 변경을 실행한다. */
/**
 * 명암·색상 테마 변경을 pointer 원점의 원형 reveal로 표시한다.
 * View Transitions API가 없으면 즉시 적용하며 keyframe은 전역 style이 소유한다.
 */
export function startThemeTransition(
  apply: () => void,
  origin?: { readonly clientX: number; readonly clientY: number }
): void {
  const root = document.documentElement;
  const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (!document.startViewTransition || prefersReducedMotion) {
    apply();
    return;
  }
  if (origin) {
    root.style.setProperty('--x', `${origin.clientX}px`);
    root.style.setProperty('--y', `${origin.clientY}px`);
  }
  document.startViewTransition(apply);
}
