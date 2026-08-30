import { z } from "zod";

import { moneyWireSchema } from "../../../values/money";

export const normalizedAuctionPricingSchema = z.strictObject({
  baseAmount: moneyWireSchema.nullable(),
  plannedAmount: moneyWireSchema.nullable(),
}).meta({
  id: "NormalizedAuctionPricing",
  description: "Nullable exact two-decimal KRW amounts observed during normalization.",
});

export type NormalizedAuctionPricing = z.infer<typeof normalizedAuctionPricingSchema>;
