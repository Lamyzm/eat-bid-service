import { auctionIdPathSchema } from "../../../atoms/identifier";
import { auctionV1ResponseSchema } from "./get-auction.response";

export const auctionV1Operations = {
  find: Object.freeze({
    method: "get" as const,
    controllerPath: "auctions" as const,
    handlerPath: ":auctionId" as const,
    path: "/api/v1/auctions/{auctionId}" as const,
    operationId: "findAuction" as const,
    summary: "Find a canonical auction" as const,
    pathExample: "9007199254740993" as const,
    pathSchema: auctionIdPathSchema,
    responseSchema: auctionV1ResponseSchema,
    errorStatuses: [400, 404, 503, 500] as const,
  }),
} as const;
