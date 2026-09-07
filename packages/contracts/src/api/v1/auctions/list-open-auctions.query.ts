/** @module 책임: 열린 공고 목록 조회 query의 필터 atom과 그 조합 계약을 소유한다. */
import { z } from "zod";

import { canonicalMoneyAmountSchema } from "../../../atoms/decimal";
import { positiveBigintTextSchema } from "../../../atoms/identifier";

// `closed`를 지원할 계획이 없어서가 아니라, 지원하지 않는 값을 계약에 적어 두면 화면이 그 값을 보낼 수
// 있기 때문에 literal 하나다. 필요해지면 enum으로 넓힌다(비파괴적).
export const openAuctionStateSchema = z.literal("open").meta({ id: "OpenAuctionState" });

// query string에는 값 봉투(`{value, unit}`)를 실을 수 없으므로 이름이 단위를 소유한다(AGENTS 15).
// 상한 720시간은 30일이며 열린 공고의 최대 마감 창을 넘는 값이다.
export const closesWithinHoursSchema = z.coerce.number().int().min(1).max(720);

// 첫 페이지 상한 100은 pages-endpoints-load.md §2의 값이다. 기본 50은 1440에서 스크롤 한 번으로
// 닿는 행 수이며 응답 크기를 절반으로 줄인다.
export const DEFAULT_OPEN_AUCTION_LIMIT = 50;

/**
 * 지역은 활성 스냅샷 build가 선언한 체계(`meta.openAuctionSnapshotBuild.regionScheme`)의 code value
 * id 하나이며 시도·시군구 어느 축이든 그 id를 가진 행만 남는다. 라벨·이름으로는 거르지 않는다
 * (AGENTS 2·6). 품목은 아직 code scheme이 없어 관측 라벨 완전일치다(EAT-39 판정 B).
 */
export const openAuctionListQuerySchema = z.strictObject({
  state: openAuctionStateSchema.default("open"),
  region: positiveBigintTextSchema.optional(),
  item: z.string().min(1).max(512).optional(),
  closesWithinHours: closesWithinHoursSchema.optional(),
  // 통화는 계약이 KRW 하나이므로 봉투 없이 금액 문자열만 받고 서버가 numeric 비교로 닫는다.
  baseAmountMin: canonicalMoneyAmountSchema.optional(),
  baseAmountMax: canonicalMoneyAmountSchema.optional(),
  cursor: positiveBigintTextSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(DEFAULT_OPEN_AUCTION_LIMIT),
});

export type OpenAuctionListQuery = z.output<typeof openAuctionListQuerySchema>;
