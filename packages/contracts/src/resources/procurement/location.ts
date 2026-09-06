/** @module 책임: 공고 응답에 싣는 공고지역 시도·시군구 코드 참조 resource를 소유한다. */
import { z } from "zod";

import { codeReferenceSchema } from "../../values/code-reference";

/**
 * 이 두 코드는 eaT 공고지역 체계의 것이고 행정안전부 행정구역과는 별개다. 그래서 코드 문자열이 아니라
 * 체계를 함께 든 `CodeReference`로 싣는다. 화면은 이 `scheme`을 분포 응답 meta의 `regionScheme`과
 * 대조해 같은 체계일 때만 지역 모집단을 그린다(AGENTS 6).
 *
 * 참가제한지역(`eligibility_area`)은 여기 없다. 그것은 "어디서 열리는가"가 아니라 "누가 낼 수 있는가"라
 * grain이 다르고 여러 값이 붙는다.
 */
export const auctionLocationSchema = z.strictObject({
  sido: codeReferenceSchema.nullable(),
  sigungu: codeReferenceSchema.nullable(),
}).meta({
  id: "AuctionLocation",
  description: "Observed announcement-region codes of one auction revision in the source region scheme.",
});

export type AuctionLocation = z.infer<typeof auctionLocationSchema>;
