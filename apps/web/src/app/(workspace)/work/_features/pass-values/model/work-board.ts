/**
 * @module 책임: 넣을 공고 응답과 등록 사업장 목록을 사업장별 이달 값 카드와 마감일·하한율 묶음 목록으로 바꾸는 표시 모델을 소유한다.
 *
 * N번 값은 등록 순서 N번째 사업장의 값이다(#228). 하한율 90% 공고 값은 이번 달 맞춤 배수에서 나와 공고마다 같으므로 카드에
 * 한 번 싣고, 88% 공고 값은 전국 공식이 참여 수 구간마다 달라 줄마다 싣는다. 값은 기초금액 대비 %로만 보인다(ADR 0074).
 * 값을 낼 수 없는 칸은 지어내지 않고 비운다.
 */
import type { BidBoardRowWire, MyBidBoardV1Response } from '@eatbid/contracts/api/v1/me';

import { bidFigure } from '@/entities/bid-figure/bid-figure';
import { daysUntil, hourMinuteText, kstOf } from './closing-time';

type Confirmed = Extract<MyBidBoardV1Response, { regionPreference: 'confirmed' }>;
type MarketHead = Confirmed['marketPick'];
type MarketCell = NonNullable<BidBoardRowWire['market']>;
type RuleCell = NonNullable<BidBoardRowWire['rule']>;
type Position = { readonly order: number; readonly amount: { readonly amount: string }; readonly baseRelativeRate: { readonly value: string } };

/** 사업장 하나의 표시 재료다. 이름은 eaT 명단에서 관측한 업체명이고, 없으면 사업자등록번호를 쓴다. */
export interface BusinessInput {
  readonly businessNumber: string;
  readonly supplierLabel?: string | null;
}

export interface ValueCard {
  readonly name: string;
  /** 하한율 90% 공고에 넣을 기초금액 대비 %다. 낼 수 없으면 null이다. */
  readonly value90: string | null;
  /** value90이 null일 때 그 칸에 쓰는 한 문장이다. 90% 공고가 하나도 없어 비었으면 null이다. */
  readonly reason90: string | null;
  /** "넘겨주기"가 복사하는 글이다. 그 사업장에 카톡으로 그대로 보낼 수 있게 이름·달·값·88% 공고를 담는다. */
  readonly passText: string;
}

export interface NoticeRow {
  readonly auctionId: string;
  readonly href: `/auctions/${string}`;
  /** "09:00"처럼 KST 마감 시각이다. 마감을 모르면 null이다. */
  readonly time: string | null;
  /** 9·10시가 아닌 마감이다. 대부분 9·10시라 다른 시각은 눈에 띄어야 놓치지 않는다. */
  readonly unusualTime: boolean;
  readonly organization: string;
  /** eaT에서 공고를 찾는 번호다. */
  readonly bidNo: string | null;
}

export interface Notice88Row extends NoticeRow {
  /** 사업장 순서대로의 88% 값이다. 전국 공식이 그 순위를 내지 않았으면 null이다. */
  readonly values: readonly (string | null)[];
}

export interface ClosingDay {
  readonly key: string;
  readonly label: string;
  readonly count: number;
  readonly rows88: readonly Notice88Row[];
  readonly rows90: readonly NoticeRow[];
  /** 하한율을 모르거나 88·90이 아닌 공고다. 값을 내지 않고 목록에만 둔다. */
  readonly rowsOther: readonly NoticeRow[];
}

export interface WorkBoard {
  readonly kind: 'board';
  /** "11월 값"처럼 카드 묶음의 이름이다. */
  readonly monthLabel: string;
  /** "10월 21일 (화) 19:00"처럼 응답 기준 시각이다. */
  readonly asOfText: string;
  readonly cards: readonly ValueCard[];
  readonly businessNames: readonly string[];
  readonly days: readonly ClosingDay[];
  /** 쪽 상한에 닿아 늦게 마감하는 공고 일부가 빠졌다는 사실이다. */
  readonly truncated: boolean;
}

export type WorkBoardView = WorkBoard | { readonly kind: 'region-unconfirmed' };

const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일'] as const;

const MARKET_REASONS: Record<MarketHead['reasons'][number], string> = {
  'market-data-unavailable': '지금은 계산하지 못했어요',
  'no-linked-business': '개찰 기록에서 이 업체를 아직 못 찾았어요',
  'market-rounds-below-minimum': '최근 석 달 공고가 적어요',
  'floor-rate-outside-market-pick': '하한율 90% 공고에만 내요',
  'floor-rate-unobserved': '하한율이 아직 안 나왔어요'
};

/** 하한율 문자열을 88·90으로 가른다. 끝의 0만 다른 표기("90", "90.000")를 같게 본다. 그 밖은 null이다. */
export function floorKind(value: string | null | undefined): 88 | 90 | null {
  if (value === null || value === undefined) return null;
  const match = /^(\d+)(?:\.(\d*))?$/.exec(value);
  if (match === null || (match[2] ?? '').replace(/0+$/, '') !== '') return null;
  return match[1] === '90' ? 90 : match[1] === '88' ? 88 : null;
}

function businessName(business: BusinessInput): string {
  if (business.supplierLabel) return business.supplierLabel;
  const digits = business.businessNumber;
  return digits.length === 10 ? `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}` : digits;
}

/** 맞춤 칸에서 순위 하나의 값이다. 사업장이 하나면 그 사업장 혼자 넣을 때의 값(`single`)을 쓴다. */
function marketValue(cell: MarketCell, order: number, businessCount: number): string | null {
  if (cell.state !== 'applicable') return null;
  const pool: readonly Position[] = [...cell.positions, ...cell.spares];
  const position = businessCount === 1 ? cell.single : pool.find((entry) => entry.order === order);
  return position === undefined ? null : bidFigure(position, null).baseRelative;
}

function ruleValue(cell: RuleCell | null, order: number): string | null {
  if (cell === null || cell.state !== 'applicable') return null;
  const position = cell.positions.find((entry) => entry.order === order);
  return position === undefined ? null : bidFigure(position, null).baseRelative;
}

function marketMonth(head: MarketHead): number {
  const month = Number(head.window.throughMonth.slice(5, 7));
  return month === 12 ? 1 : month + 1;
}

function noticeRow(row: BidBoardRowWire): NoticeRow {
  const closes = row.closesAt === null ? null : kstOf(row.closesAt);
  const time = closes === null ? null : hourMinuteText(closes);
  return {
    auctionId: row.auctionId,
    href: `/auctions/${row.auctionId}`,
    time,
    unusualTime: time !== null && time !== '09:00' && time !== '10:00',
    organization: row.organizationLabel ?? row.title ?? '공고명 미관측',
    bidNo: row.displayBidNo
  };
}

function dayLabel(asOf: ReturnType<typeof kstOf>, closes: ReturnType<typeof kstOf>): string {
  const days = daysUntil(asOf, closes);
  const date = `${closes.month}.${closes.day}(${WEEKDAYS[closes.dayOfWeek - 1]})`;
  return days <= 0 ? `오늘 ${date}` : days === 1 ? `내일 ${date}` : date;
}

function passText(name: string, month: string, value90: string | null, rows88: readonly { readonly label: string; readonly value: string }[]): string {
  const lines = [`${name} ${month}`, `하한 90%: ${value90 === null ? '없음' : `${value90}%`}`];
  if (rows88.length > 0) lines.push('하한 88%:', ...rows88.map((row) => `  ${row.label} ${row.value}%`));
  return lines.join('\n');
}

export function presentWorkBoard(response: MyBidBoardV1Response, businesses: readonly BusinessInput[]): WorkBoardView {
  // 관심 지역을 확인한 응답만 맞춤 머리를 싣는다. 그 key로 두 갈래를 가른다.
  if (!('marketPick' in response)) return { kind: 'region-unconfirmed' };
  const asOf = kstOf(response.asOf);
  const names = businesses.map(businessName);
  const count = names.length;
  const orders = names.map((_, index) => index + 1);
  const sorted = response.rows.toSorted((left, right) => (left.closesAt ?? '9').localeCompare(right.closesAt ?? '9'));

  const days = new Map<string, { label: string; rows88: Notice88Row[]; rows90: NoticeRow[]; rowsOther: NoticeRow[] }>();
  const pass88: { label: string; value: string }[][] = names.map(() => []);
  let market90: MarketCell | null = null;
  for (const row of sorted) {
    const closes = row.closesAt === null ? null : kstOf(row.closesAt);
    const key = closes === null ? 'unknown' : closes.toPlainDate().toString();
    const day = days.get(key) ?? { label: closes === null ? '마감 미확인' : dayLabel(asOf, closes), rows88: [], rows90: [], rowsOther: [] };
    days.set(key, day);
    const base = noticeRow(row);
    const kind = floorKind(row.floorRate?.value);
    if (kind === 88) {
      const values = orders.map((order) => ruleValue(row.rule, order));
      day.rows88.push({ ...base, values });
      values.forEach((value, index) => {
        if (value !== null) pass88[index]!.push({ label: `${closes === null ? '' : `${closes.month}.${closes.day} `}${base.organization}`, value });
      });
    } else if (kind === 90) {
      day.rows90.push(base);
      if (market90 === null && row.market !== null && row.market.state === 'applicable') market90 = row.market;
    } else {
      day.rowsOther.push(base);
    }
  }

  const monthLabel = `${marketMonth(response.marketPick)}월 값`;
  const has90 = [...days.values()].some((day) => day.rows90.length > 0);
  const headReason = response.marketPick.reasons[0];
  const cards = names.map((name, index): ValueCard => {
    const value90 = market90 === null ? null : marketValue(market90, index + 1, count);
    const reason90 = value90 !== null || !has90 ? null : headReason === undefined ? '이 순위 값이 없어요' : MARKET_REASONS[headReason];
    return { name, value90, reason90, passText: passText(name, monthLabel, value90, pass88[index]!) };
  });

  return {
    kind: 'board',
    monthLabel,
    asOfText: `${asOf.month}월 ${asOf.day}일 (${WEEKDAYS[asOf.dayOfWeek - 1]}) ${hourMinuteText(asOf)}`,
    cards,
    businessNames: names,
    days: [...days.entries()].map(([key, day]) => ({ key, ...day, count: day.rows88.length + day.rows90.length + day.rowsOther.length })),
    truncated: response.truncated
  };
}
