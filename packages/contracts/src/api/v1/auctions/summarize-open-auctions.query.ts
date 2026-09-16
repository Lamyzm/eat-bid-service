/** @module 책임: 열린 공고 요약 조회 query의 달력 창 atom과 목록 필터를 이어 받는 조합 계약을 소유한다. */
import { z } from "zod";

import { kstDateTextSchema } from "../../../atoms/calendar";
import { canonicalMoneyAmountSchema } from "../../../atoms/decimal";
import { positiveBigintTextSchema } from "../../../atoms/identifier";
import {
  eligibilityAreaFilterSchema,
  itemsFilterSchema,
  itemUnknownFilterSchema,
  regionUnknownFilterSchema,
  openAuctionStateSchema,
  searchTextSchema,
  sigunguFilterSchema,
} from "./list-open-auctions.query";

/**
 * 달력 창의 상한이다. 마감일 축이 2주를 기본으로 보는 이유는 사용자가 **나흘 이상 전에 낸 적이
 * 0%**이기 때문이고(n=849), 31일은 그보다 넉넉한 여유다. 창이 길어지면 응답의 `calendar` 배열만
 * 길어지고 스캔 비용은 그대로다 — 같은 집합을 날짜로 묶는 것뿐이다.
 */
export const MAX_CALENDAR_WINDOW_DAYS = 31;

/**
 * 요약은 **목록과 같은 필터 위에서** 센다. 필터가 갈리면 축 줄의 건수와 목록의 행이 서로 다른
 * 코호트를 말하게 되므로 같은 atom을 그대로 받는다.
 *
 * 다른 점은 둘이다. `cursor`와 `limit`이 없다 — 요약은 페이지가 아니라 전체를 센다. 그리고 달력 창
 * 양끝을 받는다. `closesOn`도 받지 않는다. 하루로 좁힌 요약은 그 하루만 세게 되는데 화면은 그 하루를
 * 고른 상태에서도 **달력 전체**를 계속 보여야 하기 때문이다.
 */
export const openAuctionSummaryQuerySchema = z.strictObject({
  state: openAuctionStateSchema.default("open"),
  sido: positiveBigintTextSchema.optional(),
  sigungu: sigunguFilterSchema.optional(),
  // 목록이 받는 축이면 요약도 받는다. 빠지면 `지역 미상 포함`을 켰을 때 행과 문장·달력·배지 수가 다른 집합을 말한다.
  regionUnknown: regionUnknownFilterSchema.optional(),
  eligibilityArea: eligibilityAreaFilterSchema.optional(),
  items: itemsFilterSchema.optional(),
  // 목록이 받는 축이면 요약도 받는다. 빠지면 `품목 미상 포함`을 켰을 때 표의 행과 탭·달력·배지 수가
  // 서로 다른 집합을 말한다(2026-09-16 EAT-241에서 발견).
  itemUnknown: itemUnknownFilterSchema.optional(),
  // 검색도 목록이 받는 축이다. 요약이 안 받으면 검색 중에 탭·달력·배지가 검색 전 집합을 센다(EAT-247).
  q: searchTextSchema.optional(),
  baseAmountMin: canonicalMoneyAmountSchema.optional(),
  baseAmountMax: canonicalMoneyAmountSchema.optional(),
  calendarFrom: kstDateTextSchema,
  calendarTo: kstDateTextSchema,
});

export type OpenAuctionSummaryQuery = z.output<typeof openAuctionSummaryQuerySchema>;
