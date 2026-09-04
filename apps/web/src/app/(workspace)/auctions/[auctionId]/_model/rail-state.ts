/** @module 책임: 공고 일정과 주입된 현재 시각만으로 rail이 진행 중·개찰 완료·미확인 중 무엇인지 정한다. */
import { Temporal } from '@eatbid/domain';
import type { AuctionV1Response } from '@eatbid/contracts/api/v1/auctions';

export type RailState = 'open' | 'closed' | 'unknown';

// 문자열 사전순 비교는 초 미만 정밀도가 섞이면 어긋난다("02:00:00Z" < "02:00:00.123Z"). now를 호출부
// (present-decision.ts)에서 이미 Temporal.Instant로 만들어 받아 Instant.compare로만 판정한다.
export function deriveRailState(schedule: AuctionV1Response['schedule'], now: Temporal.Instant): RailState {
  if (schedule.openedAt && Temporal.Instant.compare(now, Temporal.Instant.from(schedule.openedAt)) >= 0) return 'closed';
  if (schedule.deadlineAt && Temporal.Instant.compare(now, Temporal.Instant.from(schedule.deadlineAt)) < 0) return 'open';
  return 'unknown';
}
