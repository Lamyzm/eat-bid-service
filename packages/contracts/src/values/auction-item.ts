/** @module 책임: 품목 원자 여덟(`eatbid:auction-item`)의 wire 어휘를 소유한다. 관측 라벨을 쉼표로 쪼갠 조각이 곧 코드이며, 화면의 품목 축과 요약의 품목별 건수가 같은 여덟을 쓴다. */
import { z } from "zod";

/**
 * eaT 공고 목록의 품목 라벨은 이 여덟 조각의 쉼표 합성이다(전수 90,906 조각에서 미매핑 0 — 2026-09-16
 * 실측, EAT-230). 코드 체계 `eatbid:auction-item`은 product-managed지만 조각 자체는 eaT가 쓰는 글자라
 * 코드와 라벨이 같다. 묶음(`축산` = 육류+가금류)은 여기 없다 — 묶음을 어휘에 넣는 순간 그 정의를 우리가
 * 소유한다(2026-09-13 결정).
 *
 * 순서는 화면이 그리는 순서다. 관측 빈도가 아니라 사용자가 찾는 순서라 고정한다(시안 U9).
 * `packages/db`의 시드가 같은 여덟을 심으며(EAT-230) 그쪽이 이 목록을 읽어야 원천이 둘이 되지 않는다.
 */
export const AUCTION_ITEM_ATOMS = ["육류", "가금류", "농산물", "수산물", "가공식품", "김치류", "곡류", "우유류"] as const;

export const auctionItemAtomSchema = z.enum(AUCTION_ITEM_ATOMS).meta({
  id: "AuctionItemAtom",
  description: "One of the eight eaT item label atoms; the code and the observed label are the same text.",
});

export type AuctionItemAtom = z.infer<typeof auctionItemAtomSchema>;
