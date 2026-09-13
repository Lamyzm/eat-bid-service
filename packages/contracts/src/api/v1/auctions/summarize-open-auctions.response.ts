/** @module 책임: 열린 공고 요약 조회의 공개 V1 응답 봉투와 화면이 세는 자리를 담는 계약을 소유한다. */
import { z } from "zod";

import { kstDateTextSchema } from "../../../atoms/calendar";
import { nonNegativeCountSchema } from "../../../atoms/count";
import { instantTextSchema } from "../../../atoms/instant";
import { martBuildLineageSchema } from "../../../values/mart-lineage";
import { bidRateWireSchema } from "../../../values/rate";

/**
 * 탭 둘이 세는 수다. **`진행중` 탭의 수는 여기 없고 `totalCount`가 그 값이다** — 이 요약은 날짜 축을
 * 받지 않으므로 조건을 만족하는 열린 공고 전체가 곧 진행중이다. 같은 수를 두 자리에 실으면 언젠가
 * 한쪽만 고쳐져 탭과 축 줄이 다른 말을 한다.
 *
 * 둘은 서로 겹칠 수 있고(오늘 게시돼 오늘 마감하는 공고) 둘 다 `totalCount`의 부분집합이라 합이
 * 전체가 되지 않는다. 합으로 쓰려는 화면이 없도록 이름을 다르게 둔다.
 */
export const openAuctionTabCountsSchema = z.strictObject({
  openedToday: nonNegativeCountSchema,
  closingToday: nonNegativeCountSchema,
}).meta({ id: "OpenAuctionTabCounts" });

/**
 * 마감일 달력의 칸 하나다.
 *
 * `count`는 지금 걸린 조건의 수이고 `releasedCount`는 **지역 축만 남기고 품목·금액을 푼 수**다. 둘을
 * 함께 실어야 화면이 `2건 · 7건 중`이라고 말할 수 있다. 전부 푼 수(전국)를 싣지 않는 이유는 이 화면이
 * 답하지 않는 질문이기 때문이다.
 */
export const openAuctionCalendarDaySchema = z.strictObject({
  date: kstDateTextSchema,
  count: nonNegativeCountSchema,
  releasedCount: nonNegativeCountSchema,
}).meta({ id: "OpenAuctionCalendarDay" });

/**
 * 결과 집합의 하한율 구성이다. **언제나 배열이며 값이 하나여도 길이 1이다.**
 *
 * 하한율이 다르면 그날 하한이 다른 자리에 서서 겹치지 않는 판이므로(ADR 0034) 한 목록에 섞여 있다는
 * 사실 자체가 화면이 말해야 하는 것이다. 값이 하나면 화면이 조건 줄에 한 번 적고, 섞이면 드문 쪽만
 * 행에 표시한다. 관측되지 않은 행은 `rate`가 null인 항목으로 함께 센다.
 */
export const openAuctionFloorShareSchema = z.strictObject({
  rate: bidRateWireSchema.nullable(),
  count: nonNegativeCountSchema,
}).meta({ id: "OpenAuctionFloorShare" });

/** 마감이 있는 가장 이른 날과 그날 건수다. 0건인 날 화면이 "다음에 갈 곳"으로 쓴다. */
export const openAuctionDayMarkSchema = z.strictObject({
  date: kstDateTextSchema,
  count: nonNegativeCountSchema,
}).meta({ id: "OpenAuctionDayMark" });

export const openAuctionSummaryV1ResponseSchema = z.strictObject({
  // cursor와 무관하게 필터를 만족하는 전체 행 수다. 목록은 `limit`으로 끊기지만 이 수는 안 끊긴다.
  totalCount: nonNegativeCountSchema,
  // 표 머리의 `기관 N곳`이다. 한 기관이 품목별로 여러 건을 내므로 행 수와 다르다.
  organizationCount: nonNegativeCountSchema,
  tabs: openAuctionTabCountsSchema,
  floorShares: z.array(openAuctionFloorShareSchema).max(64),
  // 요청한 달력 창의 날짜만 싣는다. 창 밖 마감은 `totalCount`에는 들어가도 여기 없다.
  calendar: z.array(openAuctionCalendarDaySchema).max(31),
  /**
   * 이 결과를 만든 관측 중 가장 최근 시각이다. 참여 수가 언제 것인지를 화면이 이 값 하나로 말한다.
   * 한 build는 한 번의 훑기라 행마다 크게 벌어지지 않는다(2026-09-13 실측: 서로 다른 시각 2개).
   * 결과가 0건이면 null이다 — 관측이 없으므로 "지금"이라고 말할 수 없다.
   */
  latestObservedAt: instantTextSchema.nullable(),
  // 0건인 날 화면의 재료다. 앞으로 마감이 하나도 없으면 null이며 그것은 오류가 아니다.
  nextClosingDay: openAuctionDayMarkSchema.nullable(),
  meta: z.strictObject({
    // "열림"은 `closesAt > asOf` 판정이라 어느 시각 기준인지를 응답이 말해야 같은 수가 다시 나온다.
    asOf: instantTextSchema,
    calendarFrom: kstDateTextSchema,
    calendarTo: kstDateTextSchema,
    openAuctionSnapshotBuild: martBuildLineageSchema,
  }),
}).meta({ id: "EatbidApiV1OpenAuctionSummary" });

export type OpenAuctionSummaryV1Response = z.infer<typeof openAuctionSummaryV1ResponseSchema>;
export type OpenAuctionTabCounts = z.infer<typeof openAuctionTabCountsSchema>;
export type OpenAuctionCalendarDay = z.infer<typeof openAuctionCalendarDaySchema>;
export type OpenAuctionFloorShare = z.infer<typeof openAuctionFloorShareSchema>;
