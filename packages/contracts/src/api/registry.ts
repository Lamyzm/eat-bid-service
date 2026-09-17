/** @module 책임: 모든 공개 HTTP operation을 OpenAPI와 architecture 검사용 registry로 집계한다. */
import { healthOperationRegistry } from "../operations/health";
import { auctionV1OperationRegistry } from "./v1/auctions/operations";
import { codeSchemeV1OperationRegistry } from "./v1/code-schemes/operations";
import { eligibilityAreaV1OperationRegistry } from "./v1/eligibility-areas/operations";
import { myBidObservationV1OperationRegistry } from "./v1/me/bid-observations.operations";
import { myFilterCombinationV1OperationRegistry } from "./v1/me/filter-combination.operations";
import { meV1OperationRegistry } from "./v1/me/operations";
import { myRegionPreferenceV1OperationRegistry } from "./v1/me/region-preference.operations";
import { analysisV1OperationRegistry } from "./v1/analysis/operations";
import { organizationV1OperationRegistry } from "./v1/organizations/operations";
import { sessionV1OperationRegistry } from "./v1/session/operations";
import { winRateDistributionV1OperationRegistry } from "./v1/win-rate-distribution/operations";
import { createOperationRegistry } from "./operation";

// OpenAPI와 architecture 검사는 검토된 공개 operation registry 하나만 순회한다.
export const publicHttpOperationRegistry = createOperationRegistry([
  ...auctionV1OperationRegistry,
  ...organizationV1OperationRegistry,
  ...codeSchemeV1OperationRegistry,
  ...eligibilityAreaV1OperationRegistry,
  ...winRateDistributionV1OperationRegistry,
  // 상세 분석 조회다. 기관 점과 비교군을 한 응답으로 내며 유료 인가가 붙는다(EAT-216).
  ...analysisV1OperationRegistry,
  ...sessionV1OperationRegistry,
  ...meV1OperationRegistry,
  // 같은 `me` resource라 개인 응답 헤더 prefix는 계정 registry가 이미 만든다. 관심 지역도 개인 상태이며
  // 공개 registry에 함께 있어야 OpenAPI와 경계 검사가 이 두 operation을 본다.
  ...myRegionPreferenceV1OperationRegistry,
  // 같은 `me` resource라 private 응답 헤더 prefix는 이미 계정 registry가 만든다. OpenAPI와 경계
  // 검사가 이 operation을 보려면 공개 registry에도 함께 있어야 한다.
  ...myBidObservationV1OperationRegistry,
  // 저장된 조건 조합도 개인 상태라 같은 `me` resource에 산다. 건수 operation이 `:filterCombinationId`보다
  // 앞에 있어야 `counts`가 id로 먹히지 않는다 — registry 순서와 Nest handler 순서가 같아야 한다.
  ...myFilterCombinationV1OperationRegistry,
  ...healthOperationRegistry,
] as const);
