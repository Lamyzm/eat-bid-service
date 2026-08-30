import { z } from "zod";

import { instantTextSchema } from "../../../atoms/instant";

export const normalizedAuctionScheduleSchema = z.strictObject({
  announcedAt: instantTextSchema.nullable(),
  deadlineAt: instantTextSchema.nullable(),
  openedAt: instantTextSchema.nullable(),
}).meta({
  id: "NormalizedAuctionSchedule",
  description: "Nullable canonical UTC lifecycle instants observed during normalization.",
});

export type NormalizedAuctionSchedule = z.infer<typeof normalizedAuctionScheduleSchema>;
