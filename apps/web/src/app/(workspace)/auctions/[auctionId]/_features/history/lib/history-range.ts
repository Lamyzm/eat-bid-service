/** @module 책임: 과거 회차 크게 보기 부제에 적을 "불러온 회차 범위"를 표시 행의 KST 월 값에서 만든다. 서버(부제)와 client(더 불러온 뒤)가 함께 읽으므로 'use client' 없는 순수 모듈로 둔다. */
import type { HistoryRow } from '../model/attempt-history';

/** 표시용 개찰일(`YY-MM-DD`)을 되파싱하지 않고 모델이 따로 실은 KST 월을 그대로 쓴다(AGENTS 15). */
export function loadedRangeText(rows: readonly HistoryRow[]): string | null {
  if (rows.length === 0) return null;
  const newest = rows[0]!.openedMonth;
  const oldest = rows[rows.length - 1]!.openedMonth;
  return newest === oldest ? newest : `${oldest} ~ ${newest}`;
}
