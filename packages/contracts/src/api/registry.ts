/** @module 책임: 모든 공개 HTTP operation을 OpenAPI와 architecture 검사용 registry로 집계한다. */
import { healthOperationRegistry } from "../operations/health";
import { auctionV1OperationRegistry } from "./v1/auctions/operations";
import { organizationV1OperationRegistry } from "./v1/organizations/operations";
import { createOperationRegistry } from "./operation";

// OpenAPI와 architecture 검사는 검토된 공개 operation registry 하나만 순회한다.
export const publicHttpOperationRegistry = createOperationRegistry([
  ...auctionV1OperationRegistry,
  ...organizationV1OperationRegistry,
  ...healthOperationRegistry,
] as const);
