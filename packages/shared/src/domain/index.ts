/**
 * 도메인 zod 계약 — server의 nestjs-zod DTO와 web의 응답 타입이 전부 여기서 나온다.
 * 원칙: 예측 필드 금지. 과거 사실·구조 지표만.
 */
import { z } from "zod";

export const Category = z.enum(["축산", "수산", "농산", "공산", "기타"]);
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

/** 성적표 — 워크스페이스(사업자 N개 합산) 기준 */
export const FirmWinRow = z.object({
  openedAt: z.string().nullable(),
  schoolName: z.string().nullable(),
  sigungu: z.string().nullable(),
  basePrice: z.number().nullable(),
  bidRate: z.number().nullable(),
});
export type FirmWinRow = z.infer<typeof FirmWinRow>;

export const FirmRecord = z.object({
  bizNos: z.array(z.string()),
  totalBids: z.number().int(),
  totalWins: z.number().int(),
  /** 진 이유 분해: 밀림(더 낮은 업체) vs 하한 미달 */
  pushedOut: z.number().int(),
  belowFloor: z.number().int(),
  regions: z.array(z.string()),
  recentWins: z.array(FirmWinRow),
});
export type FirmRecord = z.infer<typeof FirmRecord>;

/** 월별 투찰/낙찰 추이 */
export const FirmTimelinePoint = z.object({
  ym: z.string(),               // "2025-03"
  bids: z.number().int(),
  wins: z.number().int(),
});
export type FirmTimelinePoint = z.infer<typeof FirmTimelinePoint>;

/** 조회 쿼리 계약 */
export const SchoolsQuery = z.object({
  sigungu: z.string().optional(),
  category: Category.optional(),
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type SchoolsQuery = z.infer<typeof SchoolsQuery>;

export const OpenQuery = z.object({
  /** 이 지역 자격 보유 업체 관점 필터 (허용지역 포함 여부) */
  region: z.string().optional(),
  category: Category.optional(),
});
export type OpenQuery = z.infer<typeof OpenQuery>;

/** 투찰 표시한 공고의 개찰 결과 */
export const BidResult = z.object({
  bidNo: z.string(),
  schoolName: z.string().nullable(),
  openedAt: z.string().nullable(),
  winRate: z.number().nullable(),
  myRate: z.number().nullable(),
  /** 낙찰 | 밀림 | 하한미달 | 대기(미개찰) | 기록없음 */
  status: z.enum(["낙찰", "밀림", "하한미달", "대기", "기록없음"]),
  diff: z.number().nullable(),          // 내투찰률 - 낙찰률
});
export type BidResult = z.infer<typeof BidResult>;

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

/** 특정 학교에서 내 투찰 이력 행 */
export const MyBidRow = z.object({
  openedAt: z.string().nullable(),
  floorRate: z.number().nullable(),
  basePrice: z.number().nullable(),
  bidRate: z.number().nullable(),
  winRate: z.number().nullable(),
  won: z.number().int(),
});
export type MyBidRow = z.infer<typeof MyBidRow>;
