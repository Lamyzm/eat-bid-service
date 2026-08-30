import { z } from "zod";

export const normalizedClassificationSchema = z.strictObject({
  sourceCategoryLabel: z.string().min(1).max(512).nullable(),
  categorySource: z.enum(["source_field", "inferred_from_title", "unknown"]),
}).meta({
  id: "NormalizedClassification",
  description: "Observed or explicitly inferred source classification without additional provenance claims.",
});

export type NormalizedClassification = z.infer<typeof normalizedClassificationSchema>;
