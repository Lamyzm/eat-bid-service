/** @module 책임: 보조 패널이 본문 옆에 고정되는 xl 경계 분기와 서버 렌더 시 좁은 배치의 안정된 snapshot을 제공한다. 같은 경계를 workspace-layout.css의 @variant xl이 읽는다. */
'use client';
import { useSyncExternalStore } from 'react';

import { atLeastQuery } from './breakpoints';

const query = atLeastQuery('xl');
const subscribe = (notify: () => void) => {
  const media = window.matchMedia(query);
  media.addEventListener('change', notify);
  return () => media.removeEventListener('change', notify);
};
const snapshot = () => window.matchMedia(query).matches;
const serverSnapshot = () => false;
export function useWideWorkspace() {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
