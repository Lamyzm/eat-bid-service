/**
 * @module 책임: 오늘 투찰·복기·공고 상세에 붙는 하한선 자리 입구 한 줄(범위·건수와 링크)을 고르고 조회해 문장으로 만든다.
 *
 * 그래프를 다시 그리지 않고 한 줄과 링크만 둔다(PDR-0009 결정 5). 범위는 하한선 자리 요약과 같은 함수(`floorRange`)와 같은 창으로
 * 세어 두 화면 숫자가 어긋나지 않는다. 범위 뒤에는 "넣을 자리는 아니에요"를 붙인다 — 한 줄에는 "가운데에 넣어도 절반은 하한
 * 미달" 설명을 둘 자리가 없어서다(2026-10-15 사용자 결정, 입구 시안 가안).
 *
 * 조회 함수는 주입받는다. route는 RSC 조회를, 테스트는 표본을 넣는다.
 */
import { Temporal } from '@eatbid/domain';
import type { FloorLinesV1Response } from '@eatbid/contracts/api/v1/analysis';
import type { MyFloorRegionV1Response } from '@eatbid/contracts/api/v1/me';

import { buildFloorRoute, type FloorRoute } from '@/routing/floor';
import { floorPeriod, monthWindow, periodContaining } from './floor-period';
import { floorRange } from './floor-range';
import { countText, FLOOR_RATE_TEXT, monthNumber, rateText } from './floor-units';

export interface FloorEntryView {
  readonly lead: string;
  /** 굵게 보일 숫자다. 없으면 문장만 있다. */
  readonly strong: string | null;
  readonly rest: string;
  readonly linkText: string;
  readonly href: FloorRoute;
}

type ReadFailed = { readonly kind: 'read-failed' };
type LinesRead = { readonly kind: 'lines'; readonly response: FloorLinesV1Response } | { readonly kind: 'region-not-found' } | ReadFailed;
type RegionRead = { readonly kind: 'region'; readonly response: MyFloorRegionV1Response } | { readonly kind: 'forbidden' } | ReadFailed;

export interface FloorEntryReaders {
  readonly lines: (input: {
    readonly from: string;
    readonly to: string;
    readonly floorRate: string;
    readonly sigunguCodeValueId: string;
    readonly ranks: boolean;
  }) => Promise<LinesRead>;
  readonly myRegion: (input: { readonly from: string; readonly to: string; readonly floorRate: string }) => Promise<RegionRead>;
}

const NOT_A_TARGET = '(넣을 자리는 아니에요)';

function floorsOf(response: FloorLinesV1Response): number[] {
  return response.points.map((point) => Number(point.floor.value));
}

function rangeText(floors: readonly number[]): string | null {
  const range = floorRange(floors);
  return range === null ? null : `사정률 ${rateText(range.low, 1)}~${rateText(range.high, 1)}`;
}

function monthOf(instant: string): string {
  return Temporal.Instant.from(instant).toZonedDateTimeISO('Asia/Seoul').toPlainDate().toPlainYearMonth().toString();
}

/** 최근 1년 줄이다. 오늘 투찰은 이번 달 개찰 수를 함께 말하고, 공고 상세는 "이 지역"이라고 부른다. */
export function presentRecentEntry(input: {
  readonly response: FloorLinesV1Response;
  readonly place: string;
  readonly regionId: string;
  readonly currentMonth: string;
  readonly form: 'mine' | 'this-auction';
}): FloorEntryView {
  const floors = floorsOf(input.response);
  const range = rangeText(floors);
  const subject = input.form === 'mine' ? input.place : `이 지역(${input.place})`;
  const thisMonth = input.form === 'mine'
    ? ` · 이번 달 개찰 ${countText(input.response.points.filter((point) => monthOf(point.openedAt) === input.currentMonth).length)}건`
    : '';
  const href = buildFloorRoute({ region: input.regionId });
  return range === null
    ? { lead: `${subject} 하한율 90% 공고 · 최근 1년 `, strong: `${countText(floors.length)}건`, rest: thisMonth, linkText: '하한선 자리 보기 →', href }
    : { lead: `${subject} 하한선 · 최근 1년 열 번 중 다섯 번은 `, strong: range, rest: `${NOT_A_TARGET}${thisMonth}`, linkText: '하한선 자리 보기 →', href };
}

/** 복기의 한 달 줄이다. 링크는 하한선 자리를 그 달로 확대해 열고, 그림 아래 "보이는 기간" 문장이 이 줄과 같은 숫자를 말한다. */
export function presentMonthEntry(input: {
  readonly response: FloorLinesV1Response;
  readonly place: string;
  readonly regionId: string;
  readonly month: string;
  readonly period: '3m' | '1y' | '3y';
}): FloorEntryView {
  const floors = floorsOf(input.response);
  const range = rangeText(floors);
  const name = `${monthNumber(input.month)}월`;
  const href = buildFloorRoute({ region: input.regionId, period: input.period, month: input.month });
  const linkText = `${name} 하한선 보기 →`;
  if (floors.length === 0) return { lead: `${name} ${input.place}에는 하한율 90% 공고가 없어요.`, strong: null, rest: '', linkText: '하한선 자리 보기 →', href };
  return range === null
    ? { lead: `${name} ${input.place} 하한율 90% 공고 `, strong: `${countText(floors.length)}건`, rest: '', linkText, href }
    : { lead: `${name} ${input.place} 하한율 90% 공고 ${countText(floors.length)}건 · 열 번 중 다섯 번은 `, strong: range, rest: NOT_A_TARGET, linkText, href };
}

/** 내 업체 주 공고지역이다. 운영자가 아니거나 투찰이 없거나 못 읽으면 줄을 내지 않는다 — 지역을 지어내지 않는다. */
async function myRegion(today: Temporal.PlainDate, readers: FloorEntryReaders) {
  const period = floorPeriod(today, '1y');
  const read = await readers.myRegion({ from: period.from, to: period.to, floorRate: FLOOR_RATE_TEXT });
  if (read.kind !== 'region' || read.response.region === null) return null;
  const sigungu = read.response.region.sigungu;
  return { id: sigungu.codeValueId, place: sigungu.label ?? '내 지역' };
}

export async function loadRecentEntry(today: Temporal.PlainDate, readers: FloorEntryReaders): Promise<FloorEntryView | null> {
  const region = await myRegion(today, readers);
  if (region === null) return null;
  const period = floorPeriod(today, '1y');
  const lines = await readers.lines({ from: period.from, to: period.to, floorRate: FLOOR_RATE_TEXT, sigunguCodeValueId: region.id, ranks: false });
  if (lines.kind !== 'lines') return null;
  return presentRecentEntry({ response: lines.response, place: region.place, regionId: region.id, currentMonth: period.currentMonth, form: 'mine' });
}

export async function loadMonthEntry(today: Temporal.PlainDate, month: string, readers: FloorEntryReaders): Promise<FloorEntryView | null> {
  const region = await myRegion(today, readers);
  if (region === null) return null;
  const window = monthWindow(today, month);
  const lines = await readers.lines({ ...window, floorRate: FLOOR_RATE_TEXT, sigunguCodeValueId: region.id, ranks: false });
  if (lines.kind !== 'lines') return null;
  return presentMonthEntry({ response: lines.response, place: region.place, regionId: region.id, month, period: periodContaining(today, month) });
}

/** 공고 상세 줄이다. 지역은 공고에 적힌 공고지역 시군구라 내 업체 지역을 묻지 않는다. */
export async function loadAuctionRegionEntry(
  today: Temporal.PlainDate,
  region: { readonly id: string; readonly label: string | null },
  readers: Pick<FloorEntryReaders, 'lines'>
): Promise<FloorEntryView | null> {
  const period = floorPeriod(today, '1y');
  const lines = await readers.lines({ from: period.from, to: period.to, floorRate: FLOOR_RATE_TEXT, sigunguCodeValueId: region.id, ranks: false });
  if (lines.kind !== 'lines') return null;
  return presentRecentEntry({
    response: lines.response,
    place: region.label ?? '이 지역',
    regionId: region.id,
    currentMonth: period.currentMonth,
    form: 'this-auction'
  });
}
