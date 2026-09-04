/** @module 책임: 공고 응답에 싣는 구매기관 resource를 소유하며 id만을 정체성으로 강제한다. */
import { z } from "zod";

import { positiveBigintTextSchema } from "../../atoms/identifier";

export const auctionOrganizationSchema = z.strictObject({
  organizationId: positiveBigintTextSchema,
  name: z.string().min(1).max(512).nullable(),
  type: z.string().min(1).max(64),
}).meta({ id: "AuctionOrganization", description: "Purchasing organization of one auction revision; id is the only identity." });
export type AuctionOrganization = z.infer<typeof auctionOrganizationSchema>;
