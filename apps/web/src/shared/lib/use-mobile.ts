/**
 * @module 책임: sidebar 배치가 모바일(Sheet)로 바뀌는 sm 경계 미만 분기를 hook 하나로 제공한다. 경계 값은 breakpoints 모듈이 소유한다.
 *
 * 경계가 md가 아니라 sm인 이유는 PC 반 창(683px)에서도 왼쪽 메뉴를 늘 세워 두려는 것이다(#241 정본). 그 폭에서 메뉴를 Sheet로
 * 숨기면 머리 막대가 첫 화면의 공고 줄 하나를 먹는다.
 */
import { useSyncExternalStore } from 'react';

import { belowQuery, BREAKPOINT_PX } from './breakpoints';

const MOBILE_QUERY = belowQuery('sm');

const subscribe = (notify: () => void) => {
  const media = window.matchMedia(MOBILE_QUERY);
  media.addEventListener('change', notify);
  return () => media.removeEventListener('change', notify);
};

// 판정 기준은 스타터 구현과 같은 viewport 폭이다. matchMedia는 변화 통지에만 쓴다.
const snapshot = () => window.innerWidth < BREAKPOINT_PX.sm;

// server 렌더와 hydration은 넓은 배치로 고정하고 실제 폭은 mount 후에 반영한다.
// effect에서 setState로 같은 순서를 만들면 렌더가 한 번 더 도는 것을 검사가 막는다(react/set-state-in-effect).
const serverSnapshot = () => false;

export function useIsMobile() {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
