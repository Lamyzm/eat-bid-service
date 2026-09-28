/** @module 책임: 공고 응답이 지금 보여 주는 revision에 그 공고의 최신 관측이 반영됐는지를 말하는 resource를 소유한다. */
import { z } from "zod";

import { instantTextSchema } from "../../../atoms/instant";

/**
 * 이미 공개된 공고의 더 늦은 관측이 발행에서 제외되면 옛 revision이 현행으로 남는다(ADR 0061 결정 5). 화면이 그
 * 사실을 말하지 않으면 사용자는 낡은 공고를 최신으로 읽는다.
 *
 * - `reflected`: 발행 원장에 이 공고의 더 늦은 관측이 제외로 적혀 있지 않다.
 * - `not-reflected`: 제외된 더 늦은 관측이 있다. `excludedObservedAt`은 그 관측을 받은 시각, `reflectedObservedAt`은
 *   지금 보이는 내용을 받은 시각이다.
 * - `unknown`: 판정 재료(mart build)가 아직 없다. `reflected`로 뭉개지 않는다(AGENTS 3).
 */
export const auctionLatestObservationSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("reflected") }),
  z.strictObject({
    state: z.literal("not-reflected"),
    excludedObservedAt: instantTextSchema,
    reflectedObservedAt: instantTextSchema,
  }),
  z.strictObject({ state: z.literal("unknown") }),
]).meta({
  id: "AuctionLatestObservation",
  description: "Whether the newest source observation of this auction is reflected in the shown revision, or was excluded from publication (ADR 0061).",
});

export type AuctionLatestObservation = z.infer<typeof auctionLatestObservationSchema>;
