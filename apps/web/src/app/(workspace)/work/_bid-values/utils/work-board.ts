/**
 * @module 책임: 넣을 공고 응답과 등록 사업장 목록을 내일부터의 마감일 칩, 날마다의 하한율 묶음(88%는 값이 같은 공고끼리), 사업장별
 * 이달 하한 90% 값으로 바꾸는 표시 모델을 소유한다.
 *
 * 값은 서버가 정한다. 88% 값은 공고마다 서버 규칙(`bid-position-rule.ts`)이 참여 수 대역으로 낸 순위 값이고, 90% 값은 이번 달
 * 맞춤 칸의 순위 값이다. N번 값은 등록 순서 N번째 사업장의 값이다(PDR-0011 결정 2). 이 모듈은 값을 다시 계산하지 않고 기초금액
 * 대비 % 소수 셋째 자리로 옮기기만 한다(ADR 0074). 낼 수 없는 값은 지어내지 않고 그 칸에서 까닭을 한 문장으로 말한다.
 */
import type { BidBoardRowWire, MyBidBoardV1Response } from '@eatbid/contracts/api/v1/me';

import { bidFigure } from '@/entities/bid-figure/bid-figure';
import {
  asOfText,
  closingDayText,
  daysUntil,
  hourMinuteText,
  kstOf,
  sameWeek
} from './closing-time';

type Confirmed = Extract<MyBidBoardV1Response, { regionPreference: 'confirmed' }>;
type MarketHead = Confirmed['marketPick'];
type MarketCell = NonNullable<BidBoardRowWire['market']>;
type RuleCell = NonNullable<BidBoardRowWire['rule']>;
type RuleReason = Extract<RuleCell, { state: 'not-applicable' }>['reasons'][number];
type Position = {
  readonly order: number;
  readonly amount: { readonly amount: string };
  readonly baseRelativeRate: { readonly value: string };
};

/** 사업장 하나의 표시 재료다. 이름은 eaT 명단에서 관측한 업체명이다. 사업자등록번호는 이 화면에 보이지 않는다. */
export interface BusinessInput {
  readonly supplierLabel?: string | null;
}

/** 사업장 하나의 값 칸이다. 값을 낼 수 없으면 `value`가 null이고 `reason`이 그 까닭이다. */
export interface BusinessValue {
  readonly name: string;
  /** 기초금액 대비 %, 소수 셋째 자리("88.641")다. */
  readonly value: string | null;
  readonly reason: string | null;
}

export interface NoticeRow {
  readonly auctionId: string;
  /** "09:00"처럼 KST 마감 시각이다. */
  readonly time: string;
  /** 9·10시가 아닌 마감이다. 대부분 9·10시라 다른 시각은 눈에 띄어야 놓치지 않는다. */
  readonly unusualTime: boolean;
  readonly organization: string;
  /** eaT 목록에서 공고를 알아보는 번호다. 누르는 것이 아니라 읽는 글자다. */
  readonly bidNo: string | null;
}

/** 사업장마다 값이 같은 88% 공고 묶음이다. 값이 갈리면 묶음도 나뉜다. */
export interface Group88 {
  readonly key: string;
  readonly values: readonly BusinessValue[];
  readonly rows: readonly NoticeRow[];
}

export interface ClosingDay {
  /** "2026-10-22"처럼 KST 날짜다. */
  readonly key: string;
  readonly label: string;
  readonly count: number;
  /** 앞 칩과 주가 다르다. 칩 줄은 이 자리에 구분선을 긋는다. */
  readonly weekBreak: boolean;
  readonly groups88: readonly Group88[];
  readonly rows90: readonly NoticeRow[];
  /** 하한율을 아직 모르는 공고다. 값을 내지 않고 목록에만 둔다. */
  readonly rowsOther: readonly NoticeRow[];
}

export interface WorkBoard {
  readonly kind: 'board';
  /** "10월 값"처럼 오른쪽 판의 이름이다. */
  readonly monthLabel: string;
  /** "10월 21일 (수) 저녁 7시"처럼 응답 기준 시각이다. 88% 값도 이 시각의 값이다. */
  readonly asOfText: string;
  /** 사업장마다 하한 90% 공고에 넣을 이달 값이다. */
  readonly month90: readonly BusinessValue[];
  readonly days: readonly ClosingDay[];
  /** 쪽 상한에 닿아 늦게 마감하는 공고 일부가 빠졌다는 사실이다. */
  readonly truncated: boolean;
}

export type WorkBoardView = WorkBoard | { readonly kind: 'region-unconfirmed' };

const MARKET_REASONS: Record<MarketHead['reasons'][number], string> = {
  'market-data-unavailable': '지금은 계산하지 못했어요',
  'no-linked-business': '개찰 기록에서 이 업체를 아직 못 찾았어요',
  'market-rounds-below-minimum': '최근 석 달 공고가 적어요',
  'floor-rate-outside-market-pick': '하한율 90% 공고에만 내요',
  'floor-rate-unobserved': '하한율이 아직 안 나왔어요'
};

const RULE_REASONS: Record<RuleReason, string> = {
  'participation-unobserved': '참여 업체 수가 아직 안 나왔어요',
  'participation-below-rule': '참여 업체가 적어요',
  'floor-rate-unobserved': '하한율이 아직 안 나왔어요',
  'floor-rate-outside-rule': '이 하한율에는 값을 내지 않아요'
};

const NO_BASE_AMOUNT = '기초금액이 아직 안 나왔어요';
const NO_POSITION = '값 없음';
const NO_90_NOTICE = '하한 90% 공고가 없어요';

/** 하한율 문자열을 88·90으로 가른다. 끝의 0만 다른 표기("90", "90.000")를 같게 본다. 그 밖은 null이다. */
export function floorKind(value: string | null | undefined): 88 | 90 | null {
  if (value === null || value === undefined) return null;
  const match = /^(\d+)(?:\.(\d*))?$/.exec(value);
  if (match === null || (match[2] ?? '').replace(/0+$/, '') !== '') return null;
  return match[1] === '90' ? 90 : match[1] === '88' ? 88 : null;
}

function businessName(business: BusinessInput, index: number): string {
  return business.supplierLabel ?? `${index + 1}번 사업장`;
}

function positionValue(position: Position | undefined): string | null {
  return position === undefined ? null : bidFigure(position, null).baseRelative;
}

/** 맞춤 칸에서 순위 하나의 값이다. 사업장이 하나면 그 사업장 혼자 넣을 때의 값(`single`)을 쓴다. */
function marketValue(cell: MarketCell, order: number, businessCount: number): string | null {
  if (cell.state !== 'applicable') return null;
  const pool: readonly Position[] = [...cell.positions, ...cell.spares];
  return positionValue(
    businessCount === 1 ? cell.single : pool.find((entry) => entry.order === order)
  );
}

/** 88% 공고 한 건에서 사업장 하나의 값 칸이다. 서버 규칙이 낸 순위 값을 그대로 옮긴다. */
function ruleValue(row: BidBoardRowWire, name: string, order: number): BusinessValue {
  const cell = row.rule;
  if (cell === null)
    return { name, value: null, reason: row.baseAmount === null ? NO_BASE_AMOUNT : NO_POSITION };
  if (cell.state !== 'applicable')
    return { name, value: null, reason: RULE_REASONS[cell.reasons[0]!] };
  const value = positionValue(cell.positions.find((entry) => entry.order === order));
  return { name, value, reason: value === null ? NO_POSITION : null };
}

function marketMonth(head: MarketHead): number {
  const month = Number(head.window.throughMonth.slice(5, 7));
  return month === 12 ? 1 : month + 1;
}

function noticeRow(row: BidBoardRowWire, closes: ReturnType<typeof kstOf>): NoticeRow {
  const time = hourMinuteText(closes);
  return {
    auctionId: row.auctionId,
    time,
    unusualTime: time !== '09:00' && time !== '10:00',
    organization: row.organizationLabel ?? row.title ?? '공고명 미관측',
    bidNo: row.displayBidNo
  };
}

function valuesKey(values: readonly BusinessValue[]): string {
  return values.map((entry) => entry.value ?? `!${entry.reason}`).join('|');
}

function month90Values(response: Confirmed, names: readonly string[]): BusinessValue[] {
  const rows90 = response.rows.filter((row) => floorKind(row.floorRate?.value) === 90);
  const cell =
    rows90
      .map((row) => row.market)
      .find((entry) => entry !== null && entry.state === 'applicable') ?? null;
  const headReason = response.marketPick.reasons[0];
  return names.map((name, index) => {
    const value = cell === null ? null : marketValue(cell, index + 1, names.length);
    if (value !== null) return { name, value, reason: null };
    if (rows90.length === 0) return { name, value, reason: NO_90_NOTICE };
    return {
      name,
      value,
      reason: headReason === undefined ? NO_POSITION : MARKET_REASONS[headReason]
    };
  });
}

interface DayDraft {
  readonly date: ReturnType<typeof kstOf>;
  readonly groups88: Map<string, { values: BusinessValue[]; rows: NoticeRow[] }>;
  readonly rows90: NoticeRow[];
  readonly rowsOther: NoticeRow[];
}

export function presentWorkBoard(
  response: MyBidBoardV1Response,
  businesses: readonly BusinessInput[]
): WorkBoardView {
  // 관심 지역을 확인한 응답만 맞춤 머리를 싣는다. 그 key로 두 갈래를 가른다.
  if (!('marketPick' in response)) return { kind: 'region-unconfirmed' };
  const asOf = kstOf(response.asOf);
  const names = businesses.map(businessName);
  const sorted = response.rows.toSorted((left, right) =>
    (left.closesAt ?? '9').localeCompare(right.closesAt ?? '9')
  );

  const days = new Map<string, DayDraft>();
  for (const row of sorted) {
    if (row.closesAt === null) continue;
    const closes = kstOf(row.closesAt);
    // 오늘 마감은 넣는 날이 지났다. 사장님은 마감 전날까지 넣으므로 목록은 내일부터다.
    if (daysUntil(asOf, closes) < 1) continue;
    const key = closes.toPlainDate().toString();
    const day: DayDraft = days.get(key) ?? {
      date: closes,
      groups88: new Map(),
      rows90: [],
      rowsOther: []
    };
    days.set(key, day);
    const notice = noticeRow(row, closes);
    const kind = floorKind(row.floorRate?.value);
    if (kind === 88) {
      const values = names.map((name, index) => ruleValue(row, name, index + 1));
      const groupKey = valuesKey(values);
      const group = day.groups88.get(groupKey) ?? { values, rows: [] };
      day.groups88.set(groupKey, group);
      group.rows.push(notice);
    } else if (kind === 90) {
      day.rows90.push(notice);
    } else {
      day.rowsOther.push(notice);
    }
  }

  const drafts = [...days.entries()];
  return {
    kind: 'board',
    monthLabel: `${marketMonth(response.marketPick)}월 값`,
    asOfText: asOfText(asOf),
    month90: month90Values(response, names),
    days: drafts.map(([key, day], index): ClosingDay => {
      const groups88 = [...day.groups88.entries()].map(([groupKey, group]) => ({
        key: groupKey,
        ...group
      }));
      const previous = drafts[index - 1]?.[1].date.toPlainDate();
      return {
        key,
        label: closingDayText(asOf, day.date),
        count:
          groups88.reduce((sum, group) => sum + group.rows.length, 0) +
          day.rows90.length +
          day.rowsOther.length,
        weekBreak: previous !== undefined && !sameWeek(previous, day.date.toPlainDate()),
        groups88,
        rows90: day.rows90,
        rowsOther: day.rowsOther
      };
    }),
    truncated: response.truncated
  };
}
