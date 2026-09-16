/** @module 책임: 관련 DB 발행의 미반영 경과가 분석 갱신 목표 15분을 넘었는지 판정한다. */
import { Temporal } from "../time/temporal.js";
import { minutes, toMilliseconds } from "../time/elapsed-duration.js";

const publicationUpdateTarget = minutes(15);

/** 원천 수집 시각이나 build 산출 시각이 아니라 확인된 최초 미반영 DB 발행을 기준으로 판정한다. */
export function analysisPublicationFreshness(checkedAt: Temporal.Instant, oldestPendingPublicationAt: Temporal.Instant): "updating" | "delayed" {
  if (Temporal.Instant.compare(oldestPendingPublicationAt, checkedAt) > 0) throw new RangeError("확인 시각보다 미래의 미반영 발행입니다.");
  const deadline = oldestPendingPublicationAt.add({ milliseconds: toMilliseconds(publicationUpdateTarget) });
  return Temporal.Instant.compare(checkedAt, deadline) > 0 ? "delayed" : "updating";
}
