/** 공고·학교·시장 도메인 계약 (drizzle DDL → 이 zod → web 타입) */
import { z } from "zod";
import { CATEGORIES } from "./category.js";

/** 품목 정의는 category.ts 가 SSOT. 여기서는 그 목록으로 검증만 한다. */
export const Category = z.enum(CATEGORIES);
export type Category = z.infer<typeof Category>;

/** 하한율별 낙찰 구간 통계 */
export const FloorStat = z.object({
  n: z.number().int(),
  mean: z.number(),
  dense: z.object({ lo: z.number(), hi: z.number(), pct: z.number() }).nullable(),
  p: z.array(z.number()).length(5),           // 최저/낮은편/중간/높은편/최고
  recur: z.array(z.tuple([z.number(), z.number()])), // [낙찰률, 횟수]
});
export type FloorStat = z.infer<typeof FloorStat>;

export const SchoolSummary = z.object({
  id: z.string(),
  name: z.string(),
  sido: z.string(),
  sigungu: z.string(),
  category: Category,
  nAuctions: z.number().int(),
  medField: z.number().int(),
  medBase: z.number().nullable(),
  byFloor: z.record(z.string(), FloorStat),
});
export type SchoolSummary = z.infer<typeof SchoolSummary>;

export const SchoolAuctionRow = z.object({
  bidId: z.string(),
  openedAt: z.string(),        // ISO date
  floorRate: z.number().nullable(),
  basePrice: z.number().nullable(),
  winRate: z.number().nullable(),
  nValid: z.number().int(),
});
export type SchoolAuctionRow = z.infer<typeof SchoolAuctionRow>;

export const OpenAuction = z.object({
  bidNo: z.string(),
  schoolName: z.string().nullable(),
  sigungu: z.string().nullable(),
  allowedRegions: z.array(z.string()),
  basePrice: z.number().nullable(),
  floorRate: z.number().nullable(),
  category: Category.nullable(),
  deadline: z.string().nullable(),  // ISO
  /** 파생: 기초가×하한율 — 서버가 계산해 내려줌 (아는 값) */
  anchorAmount: z.number().nullable(),
});
export type OpenAuction = z.infer<typeof OpenAuction>;

export const MarketRegion = z.object({
  sido: z.string(),
  sigungu: z.string(),
  category: Category,
  perYear: z.number().int(),
  medField: z.number().int(),
  expWin: z.number(),
  medBase: z.number().nullable(),
  marketYr: z.number().nullable(),
  top5Share: z.number().nullable(),
});
export type MarketRegion = z.infer<typeof MarketRegion>;

/** 발주 예보 — 학교 월간주기 기반 (행정 일정 추정, 낙찰 예측 아님) */
export const ForecastRow = z.object({
  schoolId: z.string(),
  schoolName: z.string(),
  lastOpened: z.string(),
  medGapDays: z.number().int(),
  expected: z.string(),                 // 예상일 ISO
  dueInDays: z.number().int(),          // 오늘 기준
});
export type ForecastRow = z.infer<typeof ForecastRow>;

