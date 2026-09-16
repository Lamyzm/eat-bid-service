/** @module 책임: 열린 공고 요약 조회(summarizeOpenAuctions) 하나만 재현하는 브라우저 검증 전용 fixture 응답기다.
 * 탭·달력·축 줄이 세는 수를 목록과 같은 표본 위에서 만들어 둘이 다른 말을 하지 않게 한다. */
import { AUCTION_ITEM_ATOMS, auctionV1Operations, openAuctionSummaryV1ResponseSchema } from '@eatbid/contracts/api/v1/auctions';
import { Temporal } from '@eatbid/domain';

import {
  filterOpenAuctionRows,
  instantSecondsIso,
  kstDateOf,
  lineage,
  type OpenAuctionFixtureRow,
  type OpenAuctionRowFilter
} from './open-auction-rows';

const operation = auctionV1Operations.summarizeOpen;

function problemResponse(status: 400 | 503, code: string, title: string): Response {
  const problem = operation.problemResponses[status].schema.parse({
    type: `https://eatbid.dev/problems/${code.toLowerCase().replaceAll('_', '-')}`,
    title,
    status,
    code,
    requestId: `fixture-request-open-auction-summary-${status}`
  });
  return Response.json(problem, { status });
}

/**
 * 하한율 구성이다. 관측하지 못한 행은 버리지 않고 `rate: null`인 항목으로 함께 센다 — 버리면 합이
 * `totalCount`와 달라져 화면이 세는 자리가 어긋난다.
 */
function floorShares(rows: readonly OpenAuctionFixtureRow[]) {
  const byRate = new Map<string | null, { rate: OpenAuctionFixtureRow['floorRate']; count: number }>();
  for (const row of rows) {
    const key = row.floorRate?.value ?? null;
    const entry = byRate.get(key);
    if (entry) entry.count += 1;
    else byRate.set(key, { rate: row.floorRate, count: 1 });
  }
  return [...byRate.values()].toSorted((left, right) => right.count - left.count);
}

/**
 * 조건 기둥의 지역 배지다. 시도별·시군구별로 세고 순서는 많은 것부터, 동률은 코드 순이다(서버와 같다).
 * 시군구는 고른 시도 안에서만 센다.
 */
function regionCounts(rows: readonly OpenAuctionFixtureRow[], axis: 'sido' | 'sigungu', withinSido: string | undefined) {
  const byRegion = new Map<string, { region: NonNullable<OpenAuctionFixtureRow['region']>['sido']; count: number }>();
  for (const row of rows) {
    if (row.region === null) continue;
    if (axis === 'sigungu' && (withinSido === undefined || row.region.sido.codeValueId !== withinSido)) continue;
    const region = row.region[axis];
    const entry = byRegion.get(region.codeValueId);
    if (entry) entry.count += 1;
    else byRegion.set(region.codeValueId, { region, count: 1 });
  }
  return [...byRegion.values()].toSorted((left, right) =>
    right.count - left.count || (left.region.code < right.region.code ? -1 : left.region.code > right.region.code ? 1 : 0)
  );
}

/** 그날 마감하는 행 수다. 마감을 관측하지 못한 행은 어느 날짜에도 속하지 않는다. */
function closingOn(rows: readonly OpenAuctionFixtureRow[], date: string): number {
  return rows.filter((row) => row.closesAt !== null && kstDateOf(row.closesAt) === date).length;
}

/** 창의 양끝을 포함한 KST 달력일 목록이다. 창 밖 마감은 `totalCount`에는 들어가도 여기 없다. */
function calendarDates(from: string, to: string): string[] {
  const dates: string[] = [];
  let cursor = Temporal.PlainDate.from(from);
  const last = Temporal.PlainDate.from(to);
  while (Temporal.PlainDate.compare(cursor, last) <= 0) {
    dates.push(cursor.toString());
    cursor = cursor.add({ days: 1 });
  }
  return dates;
}

/** 이 operation 경로가 아니면 null을 돌려줘 호출부가 다음 route로 넘어가게 한다. */
export function openAuctionSummaryResponse(request: Request): Response | null {
  const url = new URL(request.url);
  if (url.pathname !== operation.openApiPath) return null;

  const parameters: Record<string, string | string[]> = Object.fromEntries(url.searchParams);
  const selectedAreas = url.searchParams.getAll('eligibilityArea');
  if (selectedAreas.length > 0) parameters.eligibilityArea = selectedAreas;

  let query: ReturnType<typeof operation.querySchema.parse>;
  try {
    query = operation.querySchema.parse(parameters);
  } catch {
    return problemResponse(400, 'VALIDATION_ERROR', 'query가 유효하지 않음');
  }

  const now = Date.now();
  const today = kstDateOf(instantSecondsIso(now));
  const filter: OpenAuctionRowFilter = query;
  const filtered = filterOpenAuctionRows(now, filter);
  // 달력의 `N건 중`은 **지역 축만 남기고 품목·금액을 푼 수**다. 전국 수가 아니라 내 지역의 수다.
  const released = filterOpenAuctionRows(now, {
    sido: query.sido,
    sigungu: query.sigungu,
    eligibilityArea: query.eligibilityArea
  });

  // 기둥 배지는 **그 축 하나만 푼 집합**을 센다. 지역 배지는 품목·금액·제한지역을 유지한 채 지역을 풀고,
  // 품목 배지는 지역·금액·제한지역을 유지한 채 품목을 푼다 — 누르면 되는 수여야 한다.
  const regionReleased = filterOpenAuctionRows(now, {
    eligibilityArea: query.eligibilityArea,
    items: query.items,
    itemUnknown: query.itemUnknown,
    baseAmountMin: query.baseAmountMin,
    baseAmountMax: query.baseAmountMax
  });
  const itemReleased = filterOpenAuctionRows(now, {
    sido: query.sido,
    sigungu: query.sigungu,
    eligibilityArea: query.eligibilityArea,
    baseAmountMin: query.baseAmountMin,
    baseAmountMax: query.baseAmountMax
  });

  const closingDays = [...new Set(
    filtered.filter((row) => row.closesAt !== null).map((row) => kstDateOf(row.closesAt!))
  )].toSorted();
  const nextClosing = closingDays.find((date) => date >= today) ?? null;
  const observed = filtered.map((row) => row.observedAt).toSorted();

  const body = openAuctionSummaryV1ResponseSchema.parse({
    totalCount: filtered.length,
    organizationCount: new Set(
      filtered.map((row) => row.organization?.organizationId).filter((id) => id !== undefined)
    ).size,
    tabs: {
      // 게시일은 목록 행에 없고 상세 revision에서만 온다. fixture는 한 건도 관측하지 못한 build를
      // 재현하므로 0이 아니라 null이다 — 0은 "오늘 뜬 게 없다"는 다른 사실이다(AGENTS 3).
      openedToday: null,
      closingToday: closingOn(filtered, today)
    },
    announcedUnobservedCount: filtered.length,
    floorShares: floorShares(filtered),
    sidoCounts: regionCounts(regionReleased, 'sido', undefined),
    sigunguCounts: regionCounts(regionReleased, 'sigungu', query.sido),
    regionUnobservedCount: regionReleased.filter((row) => row.region === null).length,
    // 여덟 원자 전부를 0까지 싣는다. 서버의 `strpos` 부분일치와 같은 판정이다.
    itemCounts: AUCTION_ITEM_ATOMS.map((item) => ({
      item,
      count: itemReleased.filter((row) => row.itemLabel !== null && row.itemLabel.includes(item)).length
    })),
    itemUnobservedCount: itemReleased.filter((row) => row.itemLabel === null).length,
    calendar: calendarDates(query.calendarFrom, query.calendarTo).map((date) => ({
      date,
      count: closingOn(filtered, date),
      releasedCount: closingOn(released, date)
    })),
    latestObservedAt: observed.at(-1) ?? null,
    nextClosingDay: nextClosing === null
      ? null
      : { date: nextClosing, count: closingOn(filtered, nextClosing) },
    meta: {
      asOf: instantSecondsIso(now),
      calendarFrom: query.calendarFrom,
      calendarTo: query.calendarTo,
      openAuctionSnapshotBuild: lineage('mart-r2', 'eat:auction-location-sigungu')
    }
  });
  return Response.json(body);
}
