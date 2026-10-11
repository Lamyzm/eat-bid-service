/** @module 책임: 추천 투찰가 조회가 선택해 받는 응답 항목(opt-in) 입력을 검증한다. */
import { z } from "zod";

/**
 * 새 응답 항목은 요청할 때만 싣는다. 옛 server는 이 query를 읽지 않고 무시하므로 새 web이 보내도 깨지지 않고, 옛 web은 보내지
 * 않으므로 새 key를 받지 않는다(배포 순서와 무관하게 안전한 opt-in, 세션 조회와 같은 규칙).
 */
export const auctionBidPositionQuerySchema = z.strictObject({
  include: z.literal("morning-habit").optional(),
}).meta({ id: "AuctionBidPositionQuery" });

export type AuctionBidPositionQuery = z.output<typeof auctionBidPositionQuerySchema>;
