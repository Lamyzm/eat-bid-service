/** @module 책임: 캐시 무효화 요청 본문이 태그 문자열이 아닌 의미 범위임을 계약으로 고정한다. */
import { z } from "zod";

import { auctionIdPathSchema } from "../../atoms/identifier";
import { martNameSchema } from "../../values/cache-tag";

// 공고 목록의 상한이다. 이보다 넓은 범위는 `allAuctions` 한 방으로 보낸다 — 목록이 무한히 커지면
// 발행 뒤 무효화 한 번이 발행 자체보다 오래 걸린다.
export const REVALIDATE_AUCTION_ID_LIMIT = 500;

type RevalidateScope = {
  marts?: readonly string[];
  auctionIds?: readonly string[];
  allAuctions?: boolean;
};

/**
 * 범위가 하나도 없는 요청은 "아무것도 지우지 마라"가 아니라 호출자의 실수다. 조용히 204를 돌려주면
 * 무효화가 도달했다고 믿는 발행이 옛 화면을 남긴다.
 */
function requireScope(payload: z.core.ParsePayload<RevalidateScope>): void {
  const body = payload.value;
  if (body.marts?.length || body.auctionIds?.length || body.allAuctions === true) return;
  payload.issues.push({
    code: "custom",
    input: body,
    message: "무효화 범위가 비어 있습니다. marts, auctionIds, allAuctions 중 하나는 있어야 합니다.",
  });
}

/**
 * 태그 문자열을 만들고 지우는 자리는 각 API resource의 server entry뿐이다(ADR 0028-4). 호출자가
 * `"mart:" + name`을 조립하면 그 규칙이 곧바로 깨지므로 본문은 이름과 범위만 싣는다.
 */
export const revalidateWebCacheBodySchema = z.strictObject({
  marts: z.array(martNameSchema).min(1).max(martNameSchema.options.length).optional(),
  auctionIds: z.array(auctionIdPathSchema).min(1).max(REVALIDATE_AUCTION_ID_LIMIT).optional(),
  allAuctions: z.boolean().optional(),
}).check(requireScope);

export type RevalidateWebCacheBody = z.infer<typeof revalidateWebCacheBodySchema>;
