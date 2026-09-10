/** @module 책임: sidebar 배치가 모바일로 바뀌는 768px 분기를 hook 하나로 제공한다. */
import { useSyncExternalStore } from 'react';

const MOBILE_BREAKPOINT = 768;
const MOBILE_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

const subscribe = (notify: () => void) => {
  const media = window.matchMedia(MOBILE_QUERY);
  media.addEventListener('change', notify);
  return () => media.removeEventListener('change', notify);
};

// 판정 기준은 스타터 구현과 같은 viewport 폭이다. matchMedia는 변화 통지에만 쓴다.
const snapshot = () => window.innerWidth < MOBILE_BREAKPOINT;

// server 렌더와 hydration은 넓은 배치로 고정하고 실제 폭은 mount 후에 반영한다.
// effect에서 setState로 같은 순서를 만들면 렌더가 한 번 더 도는 것을 검사가 막는다(react/set-state-in-effect).
const serverSnapshot = () => false;

export function useIsMobile() {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
