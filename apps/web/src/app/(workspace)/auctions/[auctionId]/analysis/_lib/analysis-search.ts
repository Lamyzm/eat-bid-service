/** @module 책임: 새 상세의 공유 조회 조건과 표시 전용 탭·전체보기 URL 상태를 구분한다. */
import { parseAsBoolean, parseAsString, parseAsStringLiteral } from 'nuqs/server';

export const analysisViews = ['time', 'distribution'] as const;
export const analysisSearchParsers = {
  analysis: parseAsString,
  view: parseAsStringLiteral(analysisViews).withDefault('time'),
  full: parseAsBoolean.withDefault(false)
};
