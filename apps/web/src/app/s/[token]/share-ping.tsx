'use client';
import { useTrack } from '@/lib/track';

/** 공유 페이지 열람 계측 — 바이럴 수신 측정 */
export function SharePing() {
  useTrack('share_view');
  return null;
}
