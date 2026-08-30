import { z } from "zod";

const postgresSignedBigintMax = "9223372036854775807";
const firstRejectedPostgresSignedBigint = "9223372036854775808";
const signedBigintDescription =
  `Canonical positive decimal text for a PostgreSQL signed bigint; maximum ${postgresSignedBigintMax}. `
  + `${firstRejectedPostgresSignedBigint} is rejected.`;

// canonical 십진 문자열은 같은 길이에서 사전식 순서와 수의 순서가 같아 Number 없이 상한을 검사할 수 있다.
const canonicalPositiveBigintTextSchema = z.string()
  .max(19)
  .regex(/^[1-9][0-9]*$/)
  .refine(
    (value) => value.length < postgresSignedBigintMax.length
      || value.length === postgresSignedBigintMax.length && value <= postgresSignedBigintMax,
    { message: "Must fit a PostgreSQL signed bigint" },
  );

export const positiveBigintTextSchema = canonicalPositiveBigintTextSchema.meta({
  id: "PositiveBigintText",
  description: signedBigintDescription,
  example: postgresSignedBigintMax,
});

export const auctionIdPathSchema = canonicalPositiveBigintTextSchema.meta({
  id: "AuctionId",
  description: `Canonical positive decimal text for an auction ID stored as a PostgreSQL signed bigint; `
    + `maximum ${postgresSignedBigintMax}. ${firstRejectedPostgresSignedBigint} is rejected.`,
  example: postgresSignedBigintMax,
});
