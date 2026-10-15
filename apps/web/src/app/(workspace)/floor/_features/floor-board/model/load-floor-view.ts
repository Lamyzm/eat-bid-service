/**
 * @module 책임: 주소·마지막 지역·내 업체 주 공고지역·오늘 날짜로 조회 창과 지역을 정하고 세 조회(지역 목록·공고별 하한선·내 사업자 투찰)를
 * 불러 화면 상태 하나로 접는다.
 *
 * 지역은 주소 → 이 브라우저가 마지막으로 본 시군구 → 내 업체가 가장 많이 넣은 공고지역(EAT-360) 순으로 정한다. 관심 지역은 다른 코드
 * 체계라 쓰지 않는다(AGENTS 6).
 *
 * 조회 함수는 주입받는다. route는 RSC 조회를, 테스트는 표본을 넣는다.
 */
import type { Temporal } from '@eatbid/domain';
import type {
  FloorLineRegionsV1Response,
  FloorLinePeriodInput,
  FloorLinesRead,
  FloorLineWindowInput,
  MyFloorBidsRead,
  MyFloorRegionRead
} from '@/api/floor-lines';

import { floorPeriod, monthKeyOf } from '@/entities/floor-line/floor-period';
import { regionIdOf, type FloorPeriodKey } from '@/app/(workspace)/floor/_lib/floor-search';
import { FLOOR_RATE_TEXT } from '@/entities/floor-line/floor-units';
import { findRegion, presentFloorData, presentRegionGroups, type FloorScreenView } from './present-floor';

type ReadFailed = { readonly kind: 'read-failed' };

export interface FloorViewReaders {
  readonly regions: (input: FloorLinePeriodInput) => Promise<{ readonly kind: 'regions'; readonly response: FloorLineRegionsV1Response } | ReadFailed>;
  readonly lines: (input: FloorLineWindowInput & { readonly ranks: boolean }) => Promise<FloorLinesRead | ReadFailed>;
  readonly mine: (input: FloorLineWindowInput) => Promise<MyFloorBidsRead | ReadFailed>;
  readonly myRegion: (input: FloorLinePeriodInput) => Promise<MyFloorRegionRead | ReadFailed>;
}

export interface FloorViewInput {
  readonly search: { readonly region: string | null; readonly period: FloorPeriodKey; readonly ranks: boolean; readonly month: string | null };
  /** 이 브라우저가 마지막으로 본 시군구다. 주소에 지역이 없을 때만 쓴다. */
  readonly rememberedRegion: string | undefined;
  readonly today: Temporal.PlainDate;
}

/** 내 업체가 최근 1년 가장 많이 넣은 공고지역이다. 운영자가 아니거나 투찰이 없거나 못 읽으면 고르라고 한다 — 지역을 지어내지 않는다. */
async function myMainRegion(today: Temporal.PlainDate, readers: FloorViewReaders): Promise<string | null> {
  const year = floorPeriod(today, '1y');
  const read = await readers.myRegion({ from: year.from, to: year.to, floorRate: FLOOR_RATE_TEXT });
  return read.kind === 'region' ? (read.response.region?.sigungu.codeValueId ?? null) : null;
}

export async function loadFloorView(input: FloorViewInput, readers: FloorViewReaders): Promise<FloorScreenView> {
  const period = floorPeriod(input.today, input.search.period);
  const window = { from: period.from, to: period.to, floorRate: FLOOR_RATE_TEXT };
  const regionId = regionIdOf(input.search.region) ?? regionIdOf(input.rememberedRegion) ?? (await myMainRegion(input.today, readers));
  // 지역을 알면 세 조회를 함께 보낸다. 지역 목록 검사는 응답이 온 뒤에 한다 — 차례로 부르면 기다림이 두 배다.
  const [regions, lines, mine] = await Promise.all([
    readers.regions(window),
    regionId === null ? null : readers.lines({ ...window, sigunguCodeValueId: regionId, ranks: input.search.ranks }),
    regionId === null ? null : readers.mine({ ...window, sigunguCodeValueId: regionId })
  ]);
  if (regions.kind === 'read-failed') return { kind: 'regions-failed', period };
  const groups = presentRegionGroups(regions.response);
  if (regionId === null || lines === null || mine === null) return { kind: 'pick', reason: 'none', groups, period, regionId: null };
  if (lines.kind === 'region-not-found') return { kind: 'pick', reason: 'not-found', groups, period, regionId: null };
  const region = findRegion(groups, regionId);
  // 지역은 있는데 이 기간에 하한율 90% 공고가 하나도 없으면 목록에 오르지 않는다. 빈 그림 대신 다른 기간·지역을 고르게 한다.
  if (region === null) return { kind: 'pick', reason: 'empty', groups, period, regionId };
  if (lines.kind === 'read-failed') return { kind: 'lines-failed', groups, period, regionId, sidoId: region.group.id };
  const month = monthKeyOf(input.search.month);
  const focusMonth = month !== null && period.monthStarts[month] !== undefined && month <= period.currentMonth ? month : null;
  return { kind: 'ready', groups, period, data: presentFloorData({ lines: lines.response, mine, region }), focusMonth };
}
