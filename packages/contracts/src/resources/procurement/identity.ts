import { z } from "zod";

import { positiveBigintTextSchema } from "../../atoms/identifier";
import { externalBidIdSchema } from "../../atoms/source-code";

export const auctionIdentityBaseSchema = z.strictObject({
  auctionId: positiveBigintTextSchema,
  revisionId: positiveBigintTextSchema,
  externalBidId: externalBidIdSchema,
});

export const publicAuctionIdentitySchema = auctionIdentityBaseSchema.safeExtend({
  displayBidNumber: z.string().min(1).max(128).nullable(),
  title: z.string().min(1).max(512),
  status: z.string().min(1).max(64),
}).meta({
  id: "PublicAuctionIdentity",
  description: "Public identity and display state for one canonical auction revision.",
});

export type PublicAuctionIdentity = z.infer<typeof publicAuctionIdentitySchema>;
