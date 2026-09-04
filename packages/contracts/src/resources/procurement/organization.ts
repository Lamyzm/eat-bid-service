import { z } from "zod";

import { positiveBigintTextSchema } from "../../atoms/identifier";

export const auctionOrganizationSchema = z.strictObject({
  organizationId: positiveBigintTextSchema,
  name: z.string().min(1).max(512).nullable(),
  type: z.string().min(1).max(64),
}).meta({ id: "AuctionOrganization", description: "Purchasing organization of one auction revision; id is the only identity." });
export type AuctionOrganization = z.infer<typeof auctionOrganizationSchema>;
