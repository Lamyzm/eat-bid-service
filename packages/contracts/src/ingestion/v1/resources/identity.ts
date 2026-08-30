import { z } from "zod";

import { externalBidIdSchema } from "../../../atoms/source-code";

export const normalizedAuctionIdentitySchema = z.strictObject({
  externalBidId: externalBidIdSchema,
  displayBidNumber: z.string().min(1).max(128).nullable(),
  title: z.string().min(1).max(512),
  status: z.string().min(1).max(64),
}).meta({
  id: "NormalizedAuctionIdentity",
  description: "Source identity and observed display state before canonical projection.",
});

export type NormalizedAuctionIdentity = z.infer<typeof normalizedAuctionIdentitySchema>;
