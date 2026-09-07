/** @module 책임: 회차 명단을 특정 revision으로 고정하는 공개 조회 입력을 검증한다. */
import { z } from "zod";
import { positiveBigintTextSchema } from "../../../atoms/identifier";

// revision을 지정하면 이후 원본 재관측이 생겨도 그 명단을 읽는다. 미지정은 현행 공고 조회와 같은 최신 revision이다.
export const auctionRosterQuerySchema = z.strictObject({
  revisionId: positiveBigintTextSchema.optional(),
}).default({});
