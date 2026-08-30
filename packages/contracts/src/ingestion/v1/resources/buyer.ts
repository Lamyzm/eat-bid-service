import { z } from "zod";

import { sourceCodeSchema } from "../../../atoms/source-code";

export const normalizedBuyerSchema = z.strictObject({
  organizationCode: sourceCodeSchema,
  organizationName: z.string().min(1).max(512),
}).meta({
  id: "NormalizedBuyer",
  description: "Observed eaT buyer code and label before organization reconciliation.",
});

export type NormalizedBuyer = z.infer<typeof normalizedBuyerSchema>;
