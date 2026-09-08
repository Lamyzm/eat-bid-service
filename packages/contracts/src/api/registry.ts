/** @module 책임: 모든 공개 HTTP operation을 OpenAPI와 architecture 검사용 registry로 집계한다. */
import { healthOperationRegistry } from "../operations/health";
import { auctionV1OperationRegistry } from "./v1/auctions/operations";
import { codeSchemeV1OperationRegistry } from "./v1/code-schemes/operations";
import { myBidObservationV1OperationRegistry } from "./v1/me/bid-observations.operations";
import { meV1OperationRegistry } from "./v1/me/operations";
import { organizationV1OperationRegistry } from "./v1/organizations/operations";
import { sessionV1OperationRegistry } from "./v1/session/operations";
import { winRateDistributionV1OperationRegistry } from "./v1/win-rate-distribution/operations";
import { createOperationRegistry } from "./operation";

// OpenAPI와 architecture 검사는 검토된 공개 operation registry 하나만 순회한다.
export const publicHttpOperationRegistry = createOperationRegistry([
  ...auctionV1OperationRegistry,
  ...organizationV1OperationRegistry,
  ...codeSchemeV1OperationRegistry,
  ...winRateDistributionV1OperationRegistry,
  ...sessionV1OperationRegistry,
  ...meV1OperationRegistry,
  // 같은 `me` resource라 private 응답 헤더 prefix는 이미 계정 registry가 만든다. OpenAPI와 경계
  // 검사가 이 operation을 보려면 공개 registry에도 함께 있어야 한다.
  ...myBidObservationV1OperationRegistry,
  ...healthOperationRegistry,
] as const);
