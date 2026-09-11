/** @module 책임: 열린 공고 목록 조회 query의 필터 atom과 그 조합 계약을 소유한다. */
import { z } from "zod";

import { canonicalMoneyAmountSchema } from "../../../atoms/decimal";
import { positiveBigintTextSchema } from "../../../atoms/identifier";
import { maxEligibilityAreaSelection } from "../../../values/eligibility-area";

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
 * 참가제한지역 필터다. query string은 값 하나와 값 여럿을 구분하지 못하므로(`?eligibilityArea=1`은
 * 문자열, `?eligibilityArea=1&eligibilityArea=2`는 배열) 파싱 직전에 한 번만 배열로 편다. 이 정규화를
 * 화면과 서버가 각자 하면 코드 하나를 고른 사용자와 둘을 고른 사용자가 서로 다른 경로를 타게 된다.
 */
export const eligibilityAreaFilterSchema = z.preprocess(
  (value) => (value === undefined ? undefined : Array.isArray(value) ? value : [value]),
  z.array(positiveBigintTextSchema).min(1).max(maxEligibilityAreaSelection),
);

/**
 * 지역(`region`)은 **공고지역**이다. 활성 스냅샷 build가 선언한 체계
 * (`meta.openAuctionSnapshotBuild.regionScheme`)의 code value id 하나이며 시도·시군구 어느 축이든 그
 * id를 가진 행만 남는다. 라벨·이름으로는 거르지 않는다(AGENTS 2·6).
 *
 * `eligibilityArea`는 **참가제한지역**이며 위와 다른 체계다. 학교가 어디 있는지가 아니라 공고가 누구의
 * 참가를 허용하는지를 보는 축이라, 두 필터는 서로를 대체하지 않고 같은 요청에서 함께 걸릴 수 있다
 * (PDR-0001, ADR 0048). 고른 코드 하나가 만드는 매칭 집합은 `{그 코드, 그 코드의 시도 전체 코드}`이며
 * 그 확장은 서버가 한다 — 화면이 전국을 받아 client에서 자르지 않는다.
 *
 * 품목은 아직 code scheme이 없어 관측 라벨 완전일치다(EAT-39 판정 B).
 */
export const openAuctionListQuerySchema = z.strictObject({
  state: openAuctionStateSchema.default("open"),
  region: positiveBigintTextSchema.optional(),
  eligibilityArea: eligibilityAreaFilterSchema.optional(),
  item: z.string().min(1).max(512).optional(),
  closesWithinHours: closesWithinHoursSchema.optional(),
  // 통화는 계약이 KRW 하나이므로 봉투 없이 금액 문자열만 받고 서버가 numeric 비교로 닫는다.
  baseAmountMin: canonicalMoneyAmountSchema.optional(),
  baseAmountMax: canonicalMoneyAmountSchema.optional(),
  cursor: positiveBigintTextSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(DEFAULT_OPEN_AUCTION_LIMIT),
});

export type OpenAuctionListQuery = z.output<typeof openAuctionListQuerySchema>;
