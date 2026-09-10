/** @module 책임: 캐시 e2e가 관측할 fixture 요청 수와 활성 mart build 전환을 브라우저 밖에서 소유한다.
 * 제품 코드는 이 파일을 import하지 않는다. */
import { auctionV1Operations } from '@eatbid/contracts/api/v1/auctions';
import { meV1Operations } from '@eatbid/contracts/api/v1/me';
import { organizationV1Operations } from '@eatbid/contracts/api/v1/organizations';
import { sessionV1Operations } from '@eatbid/contracts/api/v1/session';
import { winRateDistributionV1Operations } from '@eatbid/contracts/api/v1/win-rate-distribution';

export const COUNTS_PATH = '/__counts';
export const ACTIVATE_BUILD_PATH = '/__activate-build';
export const RESET_PATH = '/__reset';

export type ObservedRoute =
  | 'auction'
  | 'organizationAttempts'
  | 'winRateDistribution'
  | 'session'
  | 'myBusinesses'
  | 'roster';

/**
 * `use cache` 경계 뒤에 있는 공유 read다. 캐시 스위트는 이 셋만 견준다. 세션처럼 요청마다 다시 묻는
 * read를 같이 견주면 "캐시가 살아 있다"가 아니라 "아무도 화면을 열지 않았다"를 검사하게 된다.
 */
export const CACHED_READ_ROUTES = [
  'auction',
  'organizationAttempts',
  'winRateDistribution'
] as const;

const AUCTION_PATH_PATTERN = new RegExp(
  `^${auctionV1Operations.find.openApiPath.replace('{auctionId}', '[^/]+')}$`
);
const ROSTER_PATH_PATTERN = new RegExp(
  `^${auctionV1Operations.roster.openApiPath.replace('{auctionId}', '[^/]+')}$`
);
const ORGANIZATION_PATH_PATTERN = new RegExp(
  `^${organizationV1Operations.listAuctionAttempts.openApiPath.replace('{organizationId}', '[^/]+')}$`
);
const DISTRIBUTION_PATH = winRateDistributionV1Operations.find.openApiPath;
const SESSION_PATH = sessionV1Operations.getCurrentSession.openApiPath;
const MY_BUSINESSES_PATH = meV1Operations.listMyBusinesses.openApiPath;

const counts = new Map<ObservedRoute, number>();
// build 전환 횟수다. mart별로 나누지 않는 이유는 e2e가 "전환이 있었는가"만 물어서다. 각 fixture는
// 자기 기준 build id에 이 값을 더해 새 계보를 만든다.
let activations = 0;

export function observedRoute(pathname: string): ObservedRoute | undefined {
  // 명단은 `:auctionId/roster`라 상세 경로 pattern보다 먼저 본다.
  if (ROSTER_PATH_PATTERN.test(pathname)) return 'roster';
  if (AUCTION_PATH_PATTERN.test(pathname)) return 'auction';
  if (ORGANIZATION_PATH_PATTERN.test(pathname)) return 'organizationAttempts';
  if (pathname === DISTRIBUTION_PATH) return 'winRateDistribution';
  if (pathname === SESSION_PATH) return 'session';
  if (pathname === MY_BUSINESSES_PATH) return 'myBusinesses';
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
    winRateDistribution: counts.get('winRateDistribution') ?? 0,
    session: counts.get('session') ?? 0,
    myBusinesses: counts.get('myBusinesses') ?? 0,
    roster: counts.get('roster') ?? 0
  };
}

/** 캐시 스위트가 견줄 부분만 남긴다. 이유는 `CACHED_READ_ROUTES` 주석에 있다. */
export function cachedReadCounts(
  observed: Record<ObservedRoute, number>
): Record<(typeof CACHED_READ_ROUTES)[number], number> {
  return {
    auction: observed.auction,
    organizationAttempts: observed.organizationAttempts,
    winRateDistribution: observed.winRateDistribution
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
