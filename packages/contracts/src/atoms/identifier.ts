import { z } from "zod";

const postgresSignedBigintMax = "9223372036854775807";

// canonical 십진 문자열은 같은 길이에서 사전식 순서와 수의 순서가 같아 Number 없이 상한을 검사할 수 있다.
export const positiveBigintTextSchema = z.string()
  .max(19)
  .regex(/^[1-9][0-9]*$/)
  .refine(
    (value) => value.length < postgresSignedBigintMax.length
      || value.length === postgresSignedBigintMax.length && value <= postgresSignedBigintMax,
    { message: "Must fit a PostgreSQL signed bigint" },
  )
  .meta({
    id: "PositiveBigintText",
    description: "Lossless positive PostgreSQL bigint encoded as canonical decimal text.",
  });

export const auctionIdPathSchema = positiveBigintTextSchema.meta({
  id: "AuctionId",
  description: "Lossless positive auction ID encoded as canonical decimal text.",
  example: "9007199254740993",
});
