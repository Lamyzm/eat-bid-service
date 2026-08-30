import { z } from "zod";

import { auctionResourceSchema } from "./resource";

export const auctionV1ResponseSchema = auctionResourceSchema;
export type AuctionV1Response = z.infer<typeof auctionV1ResponseSchema>;
