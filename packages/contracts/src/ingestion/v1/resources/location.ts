import { z } from "zod";

import { sourceCodeSchema } from "../../../atoms/source-code";

export const normalizedLocationSchema = z.strictObject({
  sidoCode: sourceCodeSchema.nullable(),
  sigunguCode: sourceCodeSchema.nullable(),
  eligibilityCodes: z.array(sourceCodeSchema).max(512),
}).meta({
  id: "NormalizedLocation",
  description: "Observed source-scoped location and eligibility codes; code text preserves leading zeroes.",
});

export type NormalizedLocation = z.infer<typeof normalizedLocationSchema>;
