/**
 * @module 책임: 하한선 자리로 가는 주소(지역·기간·보기·처음 확대할 달)를 만든다. 오늘 투찰·복기·공고 상세의 입구 줄이 같은 주소를 쓴다.
 *
 * 주소를 읽는 쪽(하한선 자리의 nuqs parser)과 이름이 어긋나지 않는지는 그 segment의 테스트가 이 함수의 결과를 parser로 되읽어 확인한다.
 * 기본값(최근 1년·공고별)은 주소에서 뺀다 — 같은 화면이 두 주소를 갖지 않게 한다.
 */
export type FloorRoute = '/floor' | `/floor?${string}`;

export interface FloorRouteInput {
  /** 공고지역 시군구 코드값 id다. 참가제한지역 id가 아니다(AGENTS 6). */
  readonly region: string;
  readonly period?: '3m' | '1y' | '3y';
  readonly view?: 'points' | 'months' | 'rule';
  /** `2026-09` 꼴이다. */
  readonly month?: string;
}

export function buildFloorRoute(input: FloorRouteInput): FloorRoute {
  const query = new URLSearchParams({ region: input.region });
  if (input.period !== undefined && input.period !== '1y') query.set('period', input.period);
  if (input.view !== undefined && input.view !== 'points') query.set('view', input.view);
  if (input.month !== undefined) query.set('month', input.month);
  return `/floor?${query.toString()}`;
}
