import { z } from "zod";

import { positiveBigintTextSchema } from "../atoms/identifier";
import { contentSha256Schema, sourceSystemSchema } from "../atoms/source-code";

export const auctionProvenanceSchema = z.strictObject({
  sourceSystem: sourceSystemSchema,
  observationId: positiveBigintTextSchema,
  normalizedRecordId: positiveBigintTextSchema,
  contentSha256: contentSha256Schema,
}).meta({
  id: "AuctionProvenance",
  description: "Traceability from a public auction revision to immutable source evidence and normalization.",
});

export type AuctionProvenance = z.infer<typeof auctionProvenanceSchema>;
