import { z } from "zod";

import { moneyWireSchema } from "../../values/money";

export const auctionPricingSchema = z.strictObject({
  baseAmount: moneyWireSchema,
  plannedAmount: moneyWireSchema.nullable(),
}).meta({
  id: "AuctionPricing",
  description: "Exact observed auction amounts with currency attached to each value.",
});

export type AuctionPricing = z.infer<typeof auctionPricingSchema>;
