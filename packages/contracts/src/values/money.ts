import { z } from "zod";

import { canonicalMoneyAmountSchema } from "../atoms/decimal";

export const moneyWireSchema = z.strictObject({
  amount: canonicalMoneyAmountSchema,
  currency: z.literal("KRW"),
}).meta({
  id: "Money",
  description: "Exact KRW money value; amount remains decimal text across JSON boundaries.",
});

export type MoneyWire = z.infer<typeof moneyWireSchema>;
