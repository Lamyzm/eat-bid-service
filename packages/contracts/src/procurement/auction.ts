import { z } from "zod";

const postgresSignedBigintMax = "9223372036854775807";

export const canonicalPositiveDecimalSchema = z.string()
  .max(19)
  .regex(/^[1-9][0-9]*$/)
  .refine((value) => value.length < postgresSignedBigintMax.length
    || value.length === postgresSignedBigintMax.length && value <= postgresSignedBigintMax, {
    message: "Must fit a PostgreSQL signed bigint",
  });

export const auctionIdPathSchema = canonicalPositiveDecimalSchema.meta({
  id: "AuctionId",
  description: "Lossless positive PostgreSQL bigint encoded as a canonical decimal string.",
  example: "9007199254740993",
});

const nullableTimestamp = z.iso.datetime({ offset: true }).max(35).nullable();
const nullableDecimal = z.string()
  .max(19)
  .regex(/^(?:0|[1-9][0-9]{0,15})\.[0-9]{2}$/)
  .nullable();

export const auctionResponseSchema = z.strictObject({
  auctionId: canonicalPositiveDecimalSchema,
  revisionId: canonicalPositiveDecimalSchema,
  title: z.string().min(1).max(512),
  status: z.string().min(1).max(64),
  displayBidNumber: z.string().min(1).max(128).nullable(),
  announcedAt: nullableTimestamp,
  deadlineAt: nullableTimestamp,
  openedAt: nullableTimestamp,
  baseAmount: nullableDecimal,
  plannedAmount: nullableDecimal,
  currency: z.string().regex(/^[A-Z]{3}$/),
  provenance: z.strictObject({
    sourceSystem: z.string().min(1).max(64),
    externalBidId: z.string().min(1).max(512),
    observationId: canonicalPositiveDecimalSchema,
    normalizedRecordId: canonicalPositiveDecimalSchema,
    contentSha256: z.string().regex(/^[0-9a-f]{64}$/),
  }),
}).meta({
  id: "Auction",
  description: "Canonical auction revision with source provenance.",
});

export const auctionControllerPath = "auctions";

export const auctionOperations = {
  find: Object.freeze({
    method: "get" as const,
    controllerPath: auctionControllerPath,
    handlerPath: ":auctionId" as const,
    path: "/api/v1/auctions/{auctionId}" as const,
    operationId: "findAuction" as const,
    summary: "Find a canonical auction" as const,
    pathExample: "9007199254740993" as const,
    responseSchema: auctionResponseSchema,
    errorStatuses: [400, 404, 503, 500] as const,
  }),
} as const;

export type AuctionResponse = z.infer<typeof auctionResponseSchema>;
