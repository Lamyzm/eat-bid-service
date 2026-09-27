/** @module 책임: 새 상세의 공유 조회 조건과 표시 전용 탭·전체보기 URL 상태를 구분한다. */
import { parseAsBoolean, parseAsString, parseAsStringLiteral } from 'nuqs/server';

export const analysisViews = ['time', 'distribution'] as const;
export const analysisSearchParsers = {
  analysis: parseAsString,
  view: parseAsStringLiteral(analysisViews).withDefault('time'),
  full: parseAsBoolean.withDefault(false),
  /**
   * 명단을 연 회차와 그 revision이다. 표시 전용이라 조회 조건(`analysis`)과 섞지 않는다 — 회차를 연다고
   * 표본이 바뀌면 안 된다. 주소에 두는 이유는 공유한 링크가 같은 회차의 명단을 열어야 하기 때문이다.
   * revision을 함께 두는 이유는 그 점이 그려진 관측의 명단을 읽기 위해서다. 최신 명단은 그 점이 말한
   * 결과와 다를 수 있다(ADR 0041 §1).
   */
  round: parseAsString,
  roundRevision: parseAsString
};
