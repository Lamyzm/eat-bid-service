/** @module 책임: percentage-points·ratio 단위를 명시한 비율 wire value 계약을 소유한다. */
import { z } from "zod";

import { bidRateTextSchema, percentagePointsTextSchema, ratioTextSchema } from "../atoms/decimal";

export const percentagePointsWireSchema = z.strictObject({
  value: percentagePointsTextSchema,
  unit: z.literal("percentage-points"),
}).meta({ id: "PercentagePoints", description: "A rate expressed on a 100-point scale." });

// eaT 사정률·낙찰률은 소수 셋째 자리까지 관측되며 mart numeric(6,3)과 같다. 6자리 고정인
// percentagePointsWireSchema와는 원본 정밀도가 달라 별도 wire 계약을 둔다.
export const bidRateWireSchema = z.strictObject({
  value: bidRateTextSchema,
  unit: z.literal("percentage-points"),
}).meta({
  id: "BidRate",
  description: "A bid rate expressed on a 100-point scale with exactly three fractional digits, "
    + "matching numeric(6,3) mart columns.",
});

export const ratioWireSchema = z.strictObject({
  value: ratioTextSchema,
  unit: z.literal("ratio"),
}).meta({ id: "Ratio", description: "A rate expressed on a 1.0 scale." });

export type PercentagePointsWire = z.infer<typeof percentagePointsWireSchema>;
export type BidRateWire = z.infer<typeof bidRateWireSchema>;
export type RatioWire = z.infer<typeof ratioWireSchema>;
