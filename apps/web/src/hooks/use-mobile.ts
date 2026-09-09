/** @module 책임: sidebar·infobar가 공유하는 모바일 viewport 판정을 matchMedia 구독 하나로 제공한다. */
import { useSyncExternalStore } from 'react';

const MOBILE_BREAKPOINT = 768;
const MOBILE_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

function subscribe(onStoreChange: () => void): () => void {
  const mediaQuery = window.matchMedia(MOBILE_QUERY);
  mediaQuery.addEventListener('change', onStoreChange);
  return () => mediaQuery.removeEventListener('change', onStoreChange);
}

function getSnapshot(): boolean {
  return window.matchMedia(MOBILE_QUERY).matches;
}

// 서버와 hydration 첫 렌더에서는 viewport를 알 수 없으므로 데스크톱으로 두고, 구독이 붙은 뒤 실제 값으로 바뀐다.
// effect 안에서 setState로 같은 일을 하면 첫 렌더 직후 한 번 더 렌더가 연쇄된다.
function getServerSnapshot(): boolean {
  return false;
}

export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
