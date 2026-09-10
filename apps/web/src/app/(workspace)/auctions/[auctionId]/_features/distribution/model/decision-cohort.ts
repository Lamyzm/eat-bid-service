/** @module 책임: 화면 조건 칩(기간·모집단)과 공고 응답의 코호트 재료를 분포 조회 query로 옮긴다. */
import { Temporal } from '@eatbid/domain';
import type { AuctionV1Response } from '@eatbid/contracts/api/v1/auctions';
import { organizationV1Operations, type OrganizationAuctionAttemptsQuery } from '@eatbid/contracts/api/v1/organizations';
import type { WinRateDistributionCohort } from '@/api/win-rate-distribution/index';

import type { DecisionSearch } from '@/app/(workspace)/auctions/[auctionId]/_lib/decision-search-params';

/** 모집단 칩이 잠긴 이유. 화면은 셋을 서로 다른 문장으로 말해야 사용자가 할 일을 안다. */
export type CohortLock =
  | { readonly kind: 'ready'; readonly cohort: WinRateDistributionCohort }
  | { readonly kind: 'missing-terms' }
  | { readonly kind: 'missing-axis' }
  | { readonly kind: 'unsupported-filter' };

export type DistributionPeriod = { readonly from: string; readonly to: string };

const KST_TIME_ZONE = 'Asia/Seoul';

function monthText(ordinal: number): string {
  const year = Math.floor(ordinal / 12);
  const month = (ordinal % 12) + 1;
  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}`;
}

/**
 * wire instant가 속한 KST 달을 달 서수로 읽는다. 표시 문자열을 되파싱하지 않고 시각에서 직접 만든다.
 * 달 경계는 mart의 `month_kst`와 같은 Asia/Seoul이며 UTC로 읽으면 매달 초하루가 밀린다.
 */
function kstMonthOrdinal(nowIso: string): number {
  const zoned = Temporal.Instant.from(nowIso).toZonedDateTimeISO(KST_TIME_ZONE);
  return zoned.year * 12 + (zoned.month - 1);
}

/**
 * 기간 칩 → 양끝을 포함한 KST 달 구간. 지금 KST 달의 함수이므로 현재 시각을 주입받는다.
 * `Temporal.Now`나 ambient `Date`를 여기서 부르면 서버 렌더와 브라우저가 다른 달을 볼 수 있다.
 */
export function periodOf(period: DecisionSearch['period'], nowIso: string): DistributionPeriod {
  const now = kstMonthOrdinal(nowIso);
  if (period === '지난 달') return { from: monthText(now - 1), to: monthText(now - 1) };
  const months = period === '5년' ? 60 : period === '12개월' ? 12 : period === '3개월' ? 3 : 1;
  return { from: monthText(now - (months - 1)), to: monthText(now) };
}

/**
 * 모집단 칩 → scope와 축. 재료가 없으면 조회를 만들지 않고 잠근다. 지역·기관 id를 못 얻은 채로
 * 전국으로 떨어뜨리면 화면이 사용자가 고르지 않은 모집단을 고른 것처럼 보인다.
 */
export function cohortOf(
  auction: AuctionV1Response,
  search: DecisionSearch,
  period: DistributionPeriod
): CohortLock {
  const floorRate = historyFloorOf(auction.terms?.floorRate?.value, search.floor);
  const awardMethod = auction.terms?.awardMethod?.codeValueId;
  // 하한율과 낙찰방식은 모든 모집단의 코호트 키다. 둘 중 하나라도 없으면 어떤 사다리도 만들 수 없다.
  if (awardMethod === undefined) return { kind: 'missing-terms' };
  if (floorRate === 'unknown' && search.floor == null) return { kind: 'missing-terms' };
  if (floorRate === 'all' || floorRate === 'unknown' || normalizeItemParam(search.item) !== null || search.period === '5년') {
    return { kind: 'unsupported-filter' };
  }
  const base = { floorRate, awardMethod, from: period.from, to: period.to } as const;
  if (search.scope === '전국') return { kind: 'ready', cohort: { ...base, scope: 'national' } };
  if (search.scope === '이 기관') {
    const organizationId = auction.organization?.organizationId;
    if (organizationId === undefined) return { kind: 'missing-axis' };
    return { kind: 'ready', cohort: { ...base, scope: 'organization', organizationId } };
  }
  const region = search.scope === '도' ? auction.location?.sido : auction.location?.sigungu;
  if (!region) return { kind: 'missing-axis' };
  return {
    kind: 'ready',
    cohort: {
      ...base,
      scope: search.scope === '도' ? 'province' : 'district',
      regionCodeValueId: region.codeValueId
    }
  };
}

/** URL을 직접 편집한 값도 공개 식별자 계약으로 검증한다. 라벨로 ID를 추측하지 않는다. */
export function normalizeItemParam(item: string | null): string | null {
  const parsed = organizationV1Operations.listAuctionAttempts.querySchema.unwrap().shape.item.safeParse(item);
  return parsed.success ? parsed.data ?? null : null;
}

/** 하한율은 공고 조건의 exact 값이며 미확인을 90으로 채우지 않는다. */
export function historyFloorOf(currentFloor: string | undefined, requested: string | null | undefined) {
  const parsed = organizationV1Operations.listAuctionAttempts.querySchema.unwrap().shape.floorRate.safeParse(requested);
  return parsed.success && parsed.data !== undefined ? parsed.data : currentFloor ?? 'unknown';
}

export function historyCohortOf(auction: AuctionV1Response, search: DecisionSearch, period: DistributionPeriod): Omit<OrganizationAuctionAttemptsQuery, 'limit' | 'cursor'> {
  const item = normalizeItemParam(search.item);
  return {
    floorRate: historyFloorOf(auction.terms?.floorRate?.value, search.floor),
    awardMethod: auction.terms?.awardMethod?.codeValueId ?? 'unknown',
    ...period,
    opened: 'only',
    ...(item === null ? {} : { item })
  };
}
