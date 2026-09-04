import { z } from "zod";

import { positiveBigintTextSchema } from "../../../atoms/identifier";
import { organizationAuctionAttemptSchema, organizationAuctionAttemptsMetaSchema } from "./attempt.resource";

export const organizationAuctionAttemptsV1ResponseSchema = z.strictObject({
  organizationId: positiveBigintTextSchema,
  attempts: z.array(organizationAuctionAttemptSchema).max(200),
  nextCursor: positiveBigintTextSchema.nullable(),
  meta: organizationAuctionAttemptsMetaSchema,
}).meta({ id: "EatbidApiV1OrganizationAuctionAttempts" });
export type OrganizationAuctionAttemptsV1Response = z.infer<typeof organizationAuctionAttemptsV1ResponseSchema>;
