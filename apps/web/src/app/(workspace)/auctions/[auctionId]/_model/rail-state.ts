/** @module 책임: 공고 일정과 주입된 현재 시각만으로 rail이 진행 중·개찰 완료·미확인 중 무엇인지 정한다. */
import type { AuctionV1Response } from '@eatbid/contracts/api/v1/auctions';

export type RailState = 'open' | 'closed' | 'unknown';

// ISO UTC 문자열은 사전순이 시간순과 같다. Date를 만들지 않고 비교한다.
export function deriveRailState(schedule: AuctionV1Response['schedule'], nowIso: string): RailState {
  if (schedule.openedAt && nowIso >= schedule.openedAt) return 'closed';
  if (schedule.deadlineAt && nowIso < schedule.deadlineAt) return 'open';
  return 'unknown';
}
