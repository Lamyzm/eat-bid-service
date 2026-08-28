'use client';
/**
 * CSV 저장 — 세 화면에 복제돼 있던 Blob·createElement·click 절차를 한 곳으로 (선언적 감사 6번)
 * 호출부는 "무엇을 저장할지"(헤더·행·파일명)만 넘긴다.
 *
 * BOM(﻿)을 붙인다 — 엑셀이 한글을 깨뜨리지 않게 하려던 기존 동작 그대로다.
 * objectURL 은 쓰고 해제한다(기존 세 곳 모두 누수였다).
 */
import { useCallback } from 'react';
import { todayKST } from '@eatbid/shared';

export function useCsvDownload() {
  return useCallback((opts: { filename: string; head: string; rows: (string | number | null | undefined)[][] }) => {
    const lines = opts.rows.map(cols => cols.map(c => c ?? '').join(','));
    const blob = new Blob(['﻿' + [opts.head, ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    try {
      const a = document.createElement('a');
      a.href = url;
      a.download = opts.filename;
      a.click();
    } finally {
      // 즉시 해제하면 일부 브라우저에서 저장이 취소된다
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }, []);
}

/** 파일명에 붙이는 오늘 날짜 (YYYY-MM-DD) */
export function todayStamp() {
  return todayKST();
}
