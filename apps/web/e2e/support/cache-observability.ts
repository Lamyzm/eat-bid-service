/** @module 책임: 캐시 e2e가 관측할 fixture 요청 수와 활성 mart build 전환을 브라우저 밖에서 소유한다.
 * 제품 코드는 이 파일을 import하지 않는다. */
import { auctionV1Operations } from '@eatbid/contracts/api/v1/auctions';
import { organizationV1Operations } from '@eatbid/contracts/api/v1/organizations';
import { winRateDistributionV1Operations } from '@eatbid/contracts/api/v1/win-rate-distribution';

export const COUNTS_PATH = '/__counts';
export const ACTIVATE_BUILD_PATH = '/__activate-build';
export const RESET_PATH = '/__reset';

export type ObservedRoute = 'auction' | 'organizationAttempts' | 'winRateDistribution';

const AUCTION_PATH_PATTERN = new RegExp(
  `^${auctionV1Operations.find.openApiPath.replace('{auctionId}', '[^/]+')}$`
);
const ORGANIZATION_PATH_PATTERN = new RegExp(
  `^${organizationV1Operations.listAuctionAttempts.openApiPath.replace('{organizationId}', '[^/]+')}$`
);
const DISTRIBUTION_PATH = winRateDistributionV1Operations.find.openApiPath;

const counts = new Map<ObservedRoute, number>();
// build 전환 횟수다. mart별로 나누지 않는 이유는 e2e가 "전환이 있었는가"만 물어서다. 각 fixture는
// 자기 기준 build id에 이 값을 더해 새 계보를 만든다.
let activations = 0;

export function observedRoute(pathname: string): ObservedRoute | undefined {
  if (AUCTION_PATH_PATTERN.test(pathname)) return 'auction';
  if (ORGANIZATION_PATH_PATTERN.test(pathname)) return 'organizationAttempts';
  if (pathname === DISTRIBUTION_PATH) return 'winRateDistribution';
  return undefined;
}

export function countRequest(pathname: string): void {
  const route = observedRoute(pathname);
  if (route === undefined) return;
  counts.set(route, (counts.get(route) ?? 0) + 1);
}

export function observedCounts(): Record<ObservedRoute, number> {
  return {
    auction: counts.get('auction') ?? 0,
    organizationAttempts: counts.get('organizationAttempts') ?? 0,
    winRateDistribution: counts.get('winRateDistribution') ?? 0
  };
}

/**
 * 활성 build를 한 칸 옮긴다. 무효화 없이 이 값만 바뀌면 화면은 옛 계보를 계속 보여줘야 하고, 그
 * 사실이 "push가 필요하다"를 증명한다.
 */
export function activateNextBuild(): number {
  activations += 1;
  return activations;
}

export function activatedBuildId(baseBuildId: string): string {
  return String(Number(baseBuildId) + activations);
}

export function resetObservations(): void {
  counts.clear();
  activations = 0;
}
