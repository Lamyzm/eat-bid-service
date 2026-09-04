import { z } from "zod";

import { percentagePoints3TextSchema, percentagePointsTextSchema, ratioTextSchema } from "../atoms/decimal";

export const percentagePointsWireSchema = z.strictObject({
  value: percentagePointsTextSchema,
  unit: z.literal("percentage-points"),
}).meta({ id: "PercentagePoints", description: "A rate expressed on a 100-point scale." });

// mart.org_round_summary 회차 비율은 numeric(6,3) 원본 정밀도를 그대로 실어야 하므로
// 6자리 고정인 percentagePointsWireSchema와는 별도 wire 계약을 둔다.
export const percentagePoints3WireSchema = z.strictObject({
  value: percentagePoints3TextSchema,
  unit: z.literal("percentage-points"),
}).meta({
  id: "PercentagePoints3",
  description: "A rate expressed on a 100-point scale with exactly three fractional digits, "
    + "sourced from numeric(6,3) mart columns.",
});

export const ratioWireSchema = z.strictObject({
  value: ratioTextSchema,
  unit: z.literal("ratio"),
}).meta({ id: "Ratio", description: "A rate expressed on a 1.0 scale." });

export type PercentagePointsWire = z.infer<typeof percentagePointsWireSchema>;
export type PercentagePoints3Wire = z.infer<typeof percentagePoints3WireSchema>;
export type RatioWire = z.infer<typeof ratioWireSchema>;
