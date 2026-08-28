/** API 쿼리 파라미터 계약 */
import { z } from "zod";
import { Category } from "./auction.js";

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

