/** @module 책임: 오늘 화면 브라우저 검증이 쓰는 열린 공고 표본 행과 그 위의 거르기를 한 곳에서 소유한다.
 * 목록과 요약 두 fixture가 같은 집합을 보아야 축 줄의 건수와 표의 행이 서로 다른 말을 하지 않는다. */
import { Temporal } from '@eatbid/domain';

import { activatedBuildId } from './cache-observability';

const BASE_BUILD_ID = '601';
export const HOUR = 60 * 60 * 1_000;
// build 전환으로 사라진 cursor를 재현하는 값이다. 화면은 400을 받아 cursor 없이 다시 조회해야 한다.
export const STALE_CURSOR = '9007199254740990';

// `Date#toISOString()`의 밀리초가 0으로 끝나면 instantTextSchema가 트레일링 제로를 거부하므로 초 단위로 내린다.
export function instantSecondsIso(millis: number): string {
  return new Date(Math.floor(millis / 1_000) * 1_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** 마감 시각이 속한 KST 달력일이다. 달력 칸과 `closesOn` 축이 세는 단위라 UTC 날짜로 바꾸면 밤에 어긋난다. */
export function kstDateOf(instantText: string): string {
  return Temporal.Instant.from(instantText).toZonedDateTimeISO('Asia/Seoul').toPlainDate().toString();
}

export const lineage = (calcVersion: string, regionScheme: string | null) => ({
  buildId: activatedBuildId(BASE_BUILD_ID),
  sourceReleaseId: '0f5f5d3c-6a1b-4f2e-9c8d-1a2b3c4d5e6f',
  calcVersion,
  computedAt: '2026-09-07T01:00:00Z',
  coverage: 'unknown',
  regionScheme
});

const region = {
  sido: { codeValueId: '41', code: '48', scheme: 'eat:auction-location-sido', label: '경상남도' },
  sigungu: { codeValueId: '43', code: '48120', scheme: 'eat:auction-location-sigungu', label: '창원시' }
};

// 참가제한지역은 위 `region`(공고지역)과 다른 코드 체계다(AGENTS 6, ADR 0048). 목록 응답이 이 필드를
// 늘 실으므로 fixture도 실어야 하고, `null`은 "제한 없음"이 아니라 관측하지 못했다는 뜻이라 두 상태를
// 모두 재현한다. 운영 실측에서 미관측은 학교가 아닌 기관에 몰려 있었다(2026-09-11).
const eligibilityAreas = [
  { codeValueId: '9101', code: '15650', scheme: 'eat:eligibility-area', label: '경남/전체' },
  { codeValueId: '9102', code: '15661', scheme: 'eat:eligibility-area', label: '경남/창원시' }
];

const orgSummary = {
  attemptCount: 17,
  medianListCount: 5,
  listCountSampleCount: 12,
  lastRound: {
    auctionAttemptId: '5780681',
    openedAt: '2026-09-02T02:00:00Z',
    awardedBidRate: { value: '88.3020', unit: 'percentage-points' },
    dayFloorBidRate: { value: '88.0350', unit: 'percentage-points' },
    listCount: 17,
    belowDayFloorCount: 2
  }
};

// D-day는 남은 시간이 아니라 KST 달력일이다. +2/+26시간은 밤 22시부터 다음 날짜가 되어 CI가
// 실패하므로 요청일과 해당 날짜의 마지막 초를 기준으로 오늘·내일·사흘 뒤를 만든다.
function closingDayEnd(now: number, daysAhead: number): string {
  return Temporal.Instant.fromEpochMilliseconds(now)
    .toZonedDateTimeISO('Asia/Seoul')
    .startOfDay()
    .add({ days: daysAhead + 1 })
    .subtract({ seconds: 1 })
    .toInstant()
    .toString();
}

// 긴 기관명·여러 품목 라벨은 운영에서 헤더 칩 줄을 밀었던 재료(EAT-82)와 같은 모양이다.
export function rows(now: number) {
  const observedAt = instantSecondsIso(now - 30 * 60 * 1_000);
  const base = { termsRevisionId: '5796469', observedAt, sourceLastChangedAt: null, region, eligibilityAreas, orgSummary };
  return [
    {
      ...base,
      auctionAttemptId: '5796468',
      organization: { organizationId: '3101', label: '창원 남산초등학교', type: 'unknown' },
      itemLabel: '육류 , 가금류',
      displayBidNo: '2026-0001',
      floorRate: { value: '90.000', unit: 'percentage-points' },
      closesAt: closingDayEnd(now, 0),
      baseAmount: { amount: '2761700.00', currency: 'KRW' },
      bidCount: 5
    },
    {
      ...base,
      auctionAttemptId: '5796470',
      organization: { organizationId: '3102', label: '금정구종합사회복지관식자재납품업체선정입찰공고기관', type: 'unknown' },
      itemLabel: '농산물 , 수산물 , 육류 , 가공식품 , 김치류 , 곡류 , 가금류',
      displayBidNo: '2026-0002',
      floorRate: { value: '88.000', unit: 'percentage-points' },
      closesAt: closingDayEnd(now, 1),
      baseAmount: { amount: '150000000.00', currency: 'KRW' },
      bidCount: null,
      eligibilityAreas: null,
      orgSummary: { attemptCount: 3, medianListCount: null, listCountSampleCount: 0, lastRound: null }
    },
    {
      ...base,
      auctionAttemptId: '5796471',
      organization: null,
      itemLabel: null,
      displayBidNo: null,
      floorRate: null,
      region: null,
      eligibilityAreas: null,
      termsRevisionId: null,
      closesAt: closingDayEnd(now, 3),
      baseAmount: null,
      bidCount: 0,
      orgSummary: null
    },
    {
      ...base,
      auctionAttemptId: '5796472',
      organization: { organizationId: '3103', label: null, type: 'school' },
      itemLabel: '김치류',
      displayBidNo: '2026-0004',
      floorRate: { value: '90.000', unit: 'percentage-points' },
      closesAt: null,
      baseAmount: { amount: '980200.00', currency: 'KRW' },
      bidCount: 4
    }
  ];
}

export type OpenAuctionFixtureRow = ReturnType<typeof rows>[number];

/**
 * 목록과 요약이 함께 쓰는 조건이다. 둘이 받는 축은 다르지만(요약에는 cursor·limit·날짜 하나가 없다)
 * 겹치는 축은 **같은 코드로** 걸러야 축 줄이 세는 수와 표의 행이 어긋나지 않는다.
 */
export type OpenAuctionRowFilter = {
  readonly sido?: string;
  readonly sigungu?: readonly string[];
  readonly eligibilityArea?: readonly string[];
  readonly items?: readonly string[];
  readonly itemUnknown?: 'include';
  /** 기관 이름·공고번호 안의 부분일치다. 제목은 wire에 없어 fixture는 두 열만 본다. */
  readonly q?: string;
  readonly bidState?: 'none';
  readonly closesWithinHours?: number;
  readonly closesOn?: string;
  readonly baseAmountMin?: string;
  readonly baseAmountMax?: string;
};

/** 라벨을 원자로 쪼갠다. 구분자는 원천 그대로 쉼표이고 양끝 공백은 뜻이 없다. */
export function atomsOf(label: string): readonly string[] {
  return label.split(',').map((part) => part.trim()).filter((part) => part.length > 0);
}

/** 제한지역에 걸린 행이다. 미관측은 여기서 false이며 호출부가 따로 남긴다. */
export function matchesEligibilityArea(row: OpenAuctionFixtureRow, selected: readonly string[]): boolean {
  return row.eligibilityAreas !== null
    && row.eligibilityAreas.some((area) => selected.includes(area.codeValueId));
}

/** 서버와 같은 순서로 거른다: 품목 조각 부분일치 → 검색 → 참여 → 지역 id → 기간 → 금액 → 제한지역. */
export function filterOpenAuctionRows(now: number, filter: OpenAuctionRowFilter): OpenAuctionFixtureRow[] {
  const areaFilter = filter.eligibilityArea ?? null;
  return rows(now)
    // 원자 하나라도 행의 원자 목록에 있으면 걸린다. 서버는 라벨을 쪼개지 않고 다리표를 코드로 조인하지만
    // fixture는 wire 행만 가지므로 라벨을 쪼개 같은 뜻을 낸다(EAT-230).
    // 품목 미상 포함은 품목 축이 걸렸을 때만 일한다. 축이 없으면 이미 전부 보고 있다.
    .filter((row) => filter.items === undefined
      || (row.itemLabel === null
        ? filter.itemUnknown === 'include'
        : filter.items.some((atom) => atomsOf(row.itemLabel!).includes(atom))))
    // 검색은 있는 글자에서 찾는다. 이름도 번호도 없는 행은 어떤 검색어로도 안 걸린다(AGENTS 3).
    .filter((row) => filter.q === undefined
      || (row.organization?.label ?? '').includes(filter.q)
      || (row.displayBidNo ?? '').includes(filter.q))
    // 참여 0곳은 관측된 참여 수가 0인 판이다. 못 센 판(null)은 여기 안 들어온다.
    .filter((row) => filter.bidState === undefined || row.bidCount === 0)
    // 지역은 시도 하나가 담는 그릇이고 시군구가 그 안에서 좁힌다. 서버와 같은 순서로 둘을 잇는다.
    .filter((row) => filter.sido === undefined || row.region?.sido.codeValueId === filter.sido)
    .filter((row) => filter.sigungu === undefined
      || (row.region !== null && filter.sigungu.includes(row.region.sigungu.codeValueId)))
    .filter((row) => filter.closesWithinHours === undefined
      || (row.closesAt !== null && Date.parse(row.closesAt) <= now + filter.closesWithinHours * HOUR))
    // 달력 칸이 고른 하루다. 마감을 관측하지 못한 행은 어느 날짜에도 속하지 않으므로 빠진다.
    .filter((row) => filter.closesOn === undefined
      || (row.closesAt !== null && kstDateOf(row.closesAt) === filter.closesOn))
    .filter((row) => filter.baseAmountMin === undefined
      || (row.baseAmount !== null && Number(row.baseAmount.amount) >= Number(filter.baseAmountMin)))
    .filter((row) => filter.baseAmountMax === undefined
      || (row.baseAmount !== null && Number(row.baseAmount.amount) <= Number(filter.baseAmountMax)))
    // 제한지역 필터는 고른 코드에 걸린 행과 **제한지역을 관측하지 못한 행**을 함께 남긴다. 미관측을
    // 버리면 낼 수 있는 공고가 목록에서 사라진다(ADR 0048 결정 3).
    .filter((row) => areaFilter === null || row.eligibilityAreas === null
      || matchesEligibilityArea(row, areaFilter));
}
