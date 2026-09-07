/** @module 책임: 공고 응답에 싣는 참여 업체 수 관측(목록 `BID_CNT`의 최신 관측과 하루 전 관측) resource를 소유한다. */
import { z } from "zod";

import { nonNegativeCountSchema } from "../../../atoms/count";
import { instantTextSchema } from "../../../atoms/instant";

/**
 * 참여 수는 우리가 세는 값이 아니라 eaT 목록이 표시한 `BID_CNT`의 관측이다(ADR 0030). 그래서 값 하나만
 * 싣지 않고 언제 본 값인지를 반드시 짝지운다 — 열린 공고의 참여 수는 30분 사이에도 늘어나므로
 * 관측 시각이 없는 참여 수는 사실이 아니라 추정으로 읽힌다.
 */
export const auctionParticipationObservationSchema = z.strictObject({
  bidCount: nonNegativeCountSchema,
  observedAt: instantTextSchema,
}).meta({ id: "AuctionParticipationObservation" });

/**
 * `dayEarlier`는 최신 관측보다 24시간 이상 앞선 관측 중 가장 늦은 것이다. 화면의 "어제보다 +n"은
 * 이 두 관측의 차이만 말하고, 하루 전 관측이 없으면 증감을 지어내지 않는다(AGENTS 3).
 * 목록 스냅샷에 아직 잡힌 적이 없는 공고는 블록째 null이다.
 */
export const auctionParticipationSchema = z.strictObject({
  latest: auctionParticipationObservationSchema,
  dayEarlier: auctionParticipationObservationSchema.nullable(),
}).meta({
  id: "AuctionParticipation",
  description: "Observed list-side participant count (BID_CNT) of one auction attempt: latest observation and the newest one at least a day older.",
});

export type AuctionParticipation = z.infer<typeof auctionParticipationSchema>;
export type AuctionParticipationObservation = z.infer<typeof auctionParticipationObservationSchema>;
