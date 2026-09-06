/** @module 책임: 공고 응답에 싣는 품목 분류 라벨 resource를 소유한다. */
import { z } from "zod";

/**
 * 품목은 아직 `CodeScheme`이 없다. 그래서 여기 있는 것은 소스가 준 관측 라벨 하나뿐이며 코드가 아니다.
 * 이 값을 조인 키나 URL 식별자, 코호트 키로 승격시키지 않는다(AGENTS 2). 화면에서도 헤더 칩 표시
 * 전용이고 분포 요청에는 실리지 않는다.
 *
 * 품목 코드가 생기면(EAT-66) `itemLabel` 옆에 `item: CodeReference`가 붙고, 그때 코호트 키가 될
 * 자격을 얻는 것은 라벨이 아니라 그 코드다.
 */
export const auctionClassificationSchema = z.strictObject({
  itemLabel: z.string().min(1).max(512).nullable(),
}).meta({
  id: "AuctionClassification",
  description: "Observed source category label of one auction revision; a display fact, not a code or a join key.",
});

export type AuctionClassification = z.infer<typeof auctionClassificationSchema>;
