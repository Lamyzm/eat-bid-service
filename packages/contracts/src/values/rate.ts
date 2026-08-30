import { z } from "zod";

import { percentagePointsTextSchema, ratioTextSchema } from "../atoms/decimal";

export const percentagePointsWireSchema = z.strictObject({
  value: percentagePointsTextSchema,
  unit: z.literal("percentage-points"),
}).meta({ id: "PercentagePoints", description: "A rate expressed on a 100-point scale." });

export const ratioWireSchema = z.strictObject({
  value: ratioTextSchema,
  unit: z.literal("ratio"),
}).meta({ id: "Ratio", description: "A rate expressed on a 1.0 scale." });

export type PercentagePointsWire = z.infer<typeof percentagePointsWireSchema>;
export type RatioWire = z.infer<typeof ratioWireSchema>;
