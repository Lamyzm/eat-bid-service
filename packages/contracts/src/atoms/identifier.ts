/** @module 책임: bigint 식별자와 봉인된 release UUID의 canonical wire 문자열 형태를 소유한다. */
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

// 봉인된 입력 집합의 정체성은 `ingest.source_release`의 UUID다. 대소문자를 섞으면 같은 release가 두
// 문자열이 되므로 소문자 canonical 형태만 받는다. runtime refine은 OpenAPI로 전파되지 않아 정적
// 패턴이 wire 형태를 직접 소유한다.
export const sourceReleaseIdTextSchema = z.string()
  .length(36)
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  .meta({
    id: "SourceReleaseIdText",
    description: "Canonical lowercase UUID text for a sealed ingest source release.",
    example: "0f5f5d3c-6a1b-4f2e-9c8d-1a2b3c4d5e6f",
  });

export const auctionIdPathSchema = canonicalPositiveBigintTextSchema.meta({
  id: "AuctionId",
  description: `Canonical positive decimal text for an auction ID stored as a PostgreSQL signed bigint; `
    + `maximum ${postgresSignedBigintMax}. ${firstRejectedPostgresSignedBigint} is rejected.`,
  example: postgresSignedBigintMax,
});
