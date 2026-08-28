'use client';
import { useEffect } from 'react';
import { boot } from '@/lib/session';

/** 앱 부팅 시 /api/me 1회 조회 (게스트도 200) */
export function SessionBoot() {
  useEffect(() => { void boot(); }, []);
  return null;
}
