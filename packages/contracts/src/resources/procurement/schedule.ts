import { z } from "zod";

import { instantTextSchema } from "../../atoms/instant";

export const auctionScheduleSchema = z.strictObject({
  announcedAt: instantTextSchema,
  deadlineAt: instantTextSchema.nullable(),
  openedAt: instantTextSchema.nullable(),
}).meta({
  id: "AuctionSchedule",
  description: "UTC lifecycle instants; null means that instant is not yet observed or not supplied.",
});

export type AuctionSchedule = z.infer<typeof auctionScheduleSchema>;
