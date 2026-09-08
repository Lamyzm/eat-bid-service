/** @module 책임: 보조 패널의 공통 1200px 분기와 서버 렌더 시 좁은 배치의 안정된 snapshot을 제공한다. */
'use client';
import { useSyncExternalStore } from 'react';
const query = '(min-width: 1200px)';
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
