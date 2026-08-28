/** 업체·내 성적 도메인 계약 */
import { z } from "zod";

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

