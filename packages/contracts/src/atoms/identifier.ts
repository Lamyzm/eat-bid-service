import { z } from "zod";

const postgresSignedBigintMax = "9223372036854775807";
const firstRejectedPostgresSignedBigint = "9223372036854775808";
const signedBigintDescription =
  `Canonical positive decimal text for a PostgreSQL signed bigint; maximum ${postgresSignedBigintMax}. `
  + `${firstRejectedPostgresSignedBigint} is rejected.`;
const postgresSignedBigintPattern = /^(?:[1-9][0-9]{0,17}|[1-8][0-9]{18}|9[01][0-9]{17}|92[01][0-9]{16}|922[0-2][0-9]{15}|9223[0-2][0-9]{14}|92233[0-6][0-9]{13}|922337[01][0-9]{12}|92233720[0-2][0-9]{10}|922337203[0-5][0-9]{9}|9223372036[0-7][0-9]{8}|92233720368[0-4][0-9]{7}|922337203685[0-3][0-9]{6}|9223372036854[0-6][0-9]{5}|92233720368547[0-6][0-9]{4}|922337203685477[0-4][0-9]{3}|9223372036854775[0-7][0-9]{2}|922337203685477580[0-7])$/;

// runtime refine은 OpenAPI로 전파되지 않으므로 정적 ASCII 패턴 하나가 wire 상한을 직접 소유한다.
const canonicalPositiveBigintTextSchema = z.string()
  .max(19)
  .regex(postgresSignedBigintPattern);

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
