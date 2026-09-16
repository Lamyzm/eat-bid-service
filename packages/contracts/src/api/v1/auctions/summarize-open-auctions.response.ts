/** @module 책임: 열린 공고 요약 조회의 공개 V1 응답 봉투와 화면이 세는 자리를 담는 계약을 소유한다. */
import { z } from "zod";

import { kstDateTextSchema } from "../../../atoms/calendar";
import { nonNegativeCountSchema } from "../../../atoms/count";
import { instantTextSchema } from "../../../atoms/instant";
import { AUCTION_ITEM_ATOMS, auctionItemAtomSchema } from "../../../values/auction-item";
import { codeReferenceSchema } from "../../../values/code-reference";
import { martBuildLineageSchema } from "../../../values/mart-lineage";
import { bidRateWireSchema } from "../../../values/rate";

/**
 * 탭 둘이 세는 수다. **`진행중` 탭의 수는 여기 없고 `totalCount`가 그 값이다** — 이 요약은 날짜 축을
 * 받지 않으므로 조건을 만족하는 열린 공고 전체가 곧 진행중이다. 같은 수를 두 자리에 실으면 언젠가
 * 한쪽만 고쳐져 탭과 축 줄이 다른 말을 한다.
 *
 * 둘은 서로 겹칠 수 있고(오늘 게시돼 오늘 마감하는 공고) 둘 다 `totalCount`의 부분집합이라 합이
 * 전체가 되지 않는다. 합으로 쓰려는 화면이 없도록 이름을 다르게 둔다.
 *
 * **`openedToday`는 null일 수 있다.** 게시일은 목록 행에 없고 상세 revision에서만 오므로 아직 한 건도
 * 관측하지 못한 build가 있다. 그때 0을 실으면 화면이 "오늘 새로 뜬 공고가 없다"고 말하지만 사실은
 * 세지 못한 것이다. 둘은 사용자가 할 일이 서로 다르다(AGENTS 3).
 */
export const openAuctionTabCountsSchema = z.strictObject({
  openedToday: nonNegativeCountSchema.nullable(),
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

/**
 * 지역 축을 푼 집합에서 센 지역 하나의 건수다. `region`은 공고지역 체계의 코드 참조이고 라벨은 관측이
 * 없으면 null이다 — 이름이 없다고 항목을 빼면 그 지역의 공고가 조건 기둥에서 사라진다(AGENTS 3).
 * 참가제한지역과는 다른 축이다(AGENTS 6).
 */
export const openAuctionRegionCountSchema = z.strictObject({
  region: codeReferenceSchema,
  count: nonNegativeCountSchema,
}).meta({ id: "OpenAuctionRegionCount" });

/** 품목 축을 푼 집합에서 원자 하나가 라벨에 들어 있는 행 수다. 한 행이 여러 원자를 가지므로 합은 전체보다 클 수 있다. */
export const openAuctionItemCountSchema = z.strictObject({
  item: auctionItemAtomSchema,
  count: nonNegativeCountSchema,
}).meta({ id: "OpenAuctionItemCount" });

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
  /**
   * 조건을 만족하는 행 가운데 게시일을 관측하지 못한 수다. `오늘 열린`이 부분만 센 수라는 사실을
   * 화면이 이 값 하나로 말한다. `totalCount`와 같으면 아예 셀 수 없어 `tabs.openedToday`가 null이다.
   */
  announcedUnobservedCount: nonNegativeCountSchema,
  floorShares: z.array(openAuctionFloorShareSchema).max(64),
  /**
   * 조건 기둥의 건수 배지다. 넷 다 **지금 조건에서 그 축 하나만 푼 집합**을 센다 — 시도·시군구·지역 미상은
   * 품목·금액·제한지역을 유지한 채 지역 축을 풀고, 품목·품목 미상은 지역·금액·제한지역을 유지한 채 품목
   * 축을 푼다. "누르면 몇 건이 되나"를 말하는 수라 다른 축까지 함께 풀면 그 약속이 깨진다(EAT-241).
   */
  sidoCounts: z.array(openAuctionRegionCountSchema).max(64),
  /**
   * `sido`가 걸린 요청에서만 그 시도 안의 시군구다. 활성 build에서 관측된 짝만 서므로 0건인 시군구는
   * 없고, `sido` 없이는 빈 배열이다 — 전국 시군구 235개를 기둥에 세우는 화면은 없다.
   */
  sigunguCounts: z.array(openAuctionRegionCountSchema).max(256),
  /** 지역 축을 푼 집합에서 공고지역 시도를 관측하지 못한 행 수다. 기둥의 `지역 미상` 항목이다. */
  regionUnobservedCount: nonNegativeCountSchema,
  /**
   * 원자 여덟 전부를 어휘 순서로 싣고 0도 싣는다. 0인 항목이 사라지면 사용자가 그 품목이 오늘 없는지
   * 어휘에 없는지 알 수 없다.
   */
  itemCounts: z.array(openAuctionItemCountSchema).length(AUCTION_ITEM_ATOMS.length),
  /** 품목 축을 푼 집합에서 라벨을 관측하지 못한 행 수다. 기둥의 `품목 미상` 항목이다. */
  itemUnobservedCount: nonNegativeCountSchema,
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
export type OpenAuctionRegionCount = z.infer<typeof openAuctionRegionCountSchema>;
export type OpenAuctionItemCount = z.infer<typeof openAuctionItemCountSchema>;
