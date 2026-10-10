/**
 * @module 책임: 오늘 투찰 응답을 마감 묶음·행·방법별 금액 칸·더 보기 문장으로 바꾸는 표시 모델을 소유한다.
 *
 * 방법을 하나로 고르지 않고 이름 붙여 나란히 둔다(PDR-0008). 근거가 가장 강한 칸에만 표시를 단다 — 맞춤이 나오면 맞춤, 아니면
 * 전국 공식. 금액은 문자열 그대로 자릿수를 끊고 Number로 바꾸지 않는다(AGENTS 15). 확률은 보이지 않는다.
 */
import type { BidBoardRowWire, MyBidBoardV1Response } from '@eatbid/contracts/api/v1/me';

import { decimalScale, scaledText, sumAtScale } from '@/shared/lib/decimal-sum';
import { groupLabel, hourMinuteText, kstOf, relativeText } from './closing-time';

type Confirmed = Extract<MyBidBoardV1Response, { regionPreference: 'confirmed' }>;
type MarketHead = Confirmed['marketPick'];
type MarketCell = NonNullable<BidBoardRowWire['market']>;
type RuleCell = NonNullable<BidBoardRowWire['rule']>;

export interface AmountLine {
  readonly label: string;
  /** "13,304,243원"처럼 보이는 금액이다. */
  readonly amount: string;
  /** 복사하는 값이다. 쉼표·단위 없는 원 단위 숫자다. */
  readonly copyValue: string;
}

export type AmountCell =
  | { readonly kind: 'amounts'; readonly lead: boolean; readonly lines: readonly AmountLine[] }
  | { readonly kind: 'reason'; readonly text: string };

export interface BoardRowView {
  readonly auctionId: string;
  readonly href: `/auctions/${string}`;
  readonly organization: string;
  readonly item: string;
  readonly title: string;
  readonly facts: string;
  /** 하한율 88% 공고다. 금액 없이 직접 판단으로 표시한다(PDR-0008). */
  readonly selfJudged: boolean;
  /** [이번 달 맞춤, 전국 공식] 순서가 고정이다. 직접 판단 행은 비어 있다. */
  readonly cells: readonly AmountCell[];
  readonly more: {
    readonly single: (AmountLine & { readonly note: string | null }) | null;
    readonly spares: readonly AmountLine[];
    readonly band: string | null;
  };
}

export interface ClosingGroupView {
  readonly label: string;
  readonly relative: string;
  readonly rows: readonly BoardRowView[];
}

export type BoardView =
  | { readonly kind: 'region-unconfirmed' }
  | {
    readonly kind: 'board';
    readonly lede: string;
    readonly stamp: string;
    readonly columns: readonly { readonly label: string; readonly record: string }[];
    readonly columnCaption: string;
    readonly groups: readonly ClosingGroupView[];
  };

const GROUPING = /\B(?=(\d{3})+(?!\d))/g;
const wholeWon = (amount: string) => amount.split('.')[0]!;
const wonText = (amount: string) => `${wholeWon(amount).replace(GROUPING, ',')}원`;
const line = (label: string, amount: string): AmountLine => ({ label, amount: wonText(amount), copyValue: wholeWon(amount) });

const MARKET_REASONS: Record<Extract<MarketCell, { state: 'not-applicable' }>['reasons'][number], string> = {
  'market-data-unavailable': '지금은 계산하지 못했어요',
  'no-linked-business': '등록 업체 미확인',
  'market-rounds-below-minimum': '석 달 공고 부족',
  'floor-rate-outside-market-pick': '하한율 90%만',
  'floor-rate-unobserved': '하한율 미확인'
};

const RULE_REASONS: Record<Extract<RuleCell, { state: 'not-applicable' }>['reasons'][number], string> = {
  'participation-unobserved': '참여 수 미확인',
  'participation-below-rule': '참여 2곳 미만',
  'floor-rate-outside-rule': '표에 없는 하한율',
  'floor-rate-unobserved': '하한율 미확인'
};

function marketMonth(head: MarketHead): number {
  const month = Number(head.window.throughMonth.slice(5, 7));
  return month === 12 ? 1 : month + 1;
}

function marketStamp(head: MarketHead): string {
  if (head.state === 'picked') {
    const from = Number(head.window.fromMonth.slice(5, 7));
    const through = Number(head.window.throughMonth.slice(5, 7));
    return `${marketMonth(head)}월 맞춤 금액은 ${from}~${through}월 내 사업자 공고 ${(head.marketRounds ?? 0).toLocaleString('ko-KR')}건으로 골랐어요`;
  }
  if (head.reasons.includes('market-rounds-below-minimum')) {
    return `최근 석 달 내 사업자 공고가 ${(head.marketRounds ?? 0).toLocaleString('ko-KR')}건이라 맞춤 금액을 고르지 않았어요(${head.minimumRounds}건 이상 필요)`;
  }
  if (head.reasons.includes('no-linked-business')) return '내 사업자에 등록한 업체가 개찰 기록에서 아직 확인되지 않아 맞춤 금액이 없어요';
  return '지금은 맞춤 금액을 계산하지 못했어요. 잠시 뒤 새로고침해 주세요.';
}

function columnsOf(head: MarketHead) {
  const evidence = head.evidence;
  const sum = (field: 'expectedWins' | 'ruleExpectedWins') => {
    const values = evidence.map((entry) => entry[field]);
    const scale = decimalScale(values);
    return `${scaledText(sumAtScale(values, scale), scale)}건`;
  };
  const rounds = evidence.reduce((total, entry) => total + entry.rounds, 0);
  return {
    columns: [
      { label: `${marketMonth(head)}월 맞춤`, record: sum('expectedWins') },
      { label: '전국 공식', record: sum('ruleExpectedWins') }
    ],
    columnCaption: `같은 공고 ${rounds.toLocaleString('ko-KR')}건에 대어 본 낙찰 수(두 장)`
  };
}

function marketCellOf(row: BidBoardRowWire): AmountCell {
  if (row.market === null) return { kind: 'reason', text: '기초금액 미확인' };
  if (row.market.state === 'not-applicable') {
    return { kind: 'reason', text: row.market.reasons.map((reason) => MARKET_REASONS[reason]).join(' · ') };
  }
  return { kind: 'amounts', lead: true, lines: row.market.positions.map((position) => line(`${position.order}번`, position.amount.amount)) };
}

function ruleCellOf(row: BidBoardRowWire, marketLead: boolean): AmountCell {
  if (row.rule === null) return { kind: 'reason', text: '기초금액 미확인' };
  if (row.rule.state === 'not-applicable') {
    return { kind: 'reason', text: row.rule.reasons.map((reason) => RULE_REASONS[reason]).join(' · ') };
  }
  return {
    kind: 'amounts',
    lead: !marketLead,
    lines: row.rule.positions.slice(0, 2).map((position) => line(`${position.order}번`, position.amount.amount))
  };
}

function moreOf(row: BidBoardRowWire): BoardRowView['more'] {
  const market = row.market?.state === 'applicable' ? row.market : null;
  const rule = row.rule?.state === 'applicable' ? row.rule : null;
  const single = market === null ? null : {
    ...line('한 곳만 넣을 때', market.single.amount.amount),
    note: market.single.amount.amount === market.positions[0]!.amount.amount ? '이번 달은 1번과 같은 금액' : null
  };
  const band = rule === null ? null : rule.band.maxBidCount === null
    ? `전국 공식은 참여 ${rule.band.minBidCount}곳 이상 표를 썼어요`
    : `전국 공식은 참여 ${rule.band.minBidCount}~${rule.band.maxBidCount}곳 표를 썼어요`;
  return {
    single,
    spares: [
      ...(market?.spares.map((spare) => line(`예비 ${spare.order}순위`, spare.amount.amount)) ?? []),
      ...(rule?.positions.slice(2).map((position) => line(`전국 공식 ${position.order}번`, position.amount.amount)) ?? [])
    ],
    band
  };
}

function rowOf(row: BidBoardRowWire): BoardRowView {
  const selfJudged = row.floorRate?.value === '88.000';
  const market = marketCellOf(row);
  const marketLead = market.kind === 'amounts';
  const base = row.baseAmount === null ? '기초금액 미확인' : `기초금액 ${wonText(row.baseAmount.amount)}`;
  const participation = row.bidCount === null ? '참여 미확인' : `참여 ${row.bidCount.toLocaleString('ko-KR')}곳`;
  return {
    auctionId: row.auctionId,
    href: `/auctions/${encodeURIComponent(row.auctionId)}`,
    organization: row.organizationLabel ?? '기관 미관측',
    item: row.itemLabel === null ? '품목 미상' : row.itemLabel.split(',').map((part) => part.trim()).filter(Boolean).join(' · '),
    title: row.title ?? '제목 미관측',
    facts: `${base} · ${participation}`,
    selfJudged,
    cells: selfJudged ? [] : [market, ruleCellOf(row, marketLead)],
    more: selfJudged ? { single: null, spares: [], band: null } : moreOf(row)
  };
}

export function presentBidBoard(response: MyBidBoardV1Response): BoardView {
  // 관심 지역이 확인된 응답만 맞춤 방법 머리를 싣는다. 확인 여부 필드를 문자열로 비교하면 지역 어휘 검사가 지역 이름 비교로 읽는다.
  if (!('marketPick' in response)) return { kind: 'region-unconfirmed' };
  const asOf = kstOf(response.asOf);
  const groups = new Map<string, { label: string; relative: string; rows: BoardRowView[] }>();
  let today = 0;
  let tomorrow = 0;
  // 서버가 마감 순으로 준다. 같은 마감 시각끼리 한 묶음이다.
  for (const row of response.rows) {
    if (row.closesAt === null) continue;
    const closes = kstOf(row.closesAt);
    if (closes.toPlainDate().equals(asOf.toPlainDate())) today += 1;
    else tomorrow += 1;
    const key = closes.toString();
    const group = groups.get(key) ?? { label: groupLabel(asOf, closes), relative: relativeText(asOf, closes), rows: [] };
    group.rows.push(rowOf(row));
    groups.set(key, group);
  }
  return {
    kind: 'board',
    lede: today + tomorrow === 0 ? '오늘·내일 마감 공고가 없어요.' : `오늘 마감 ${today}건, 내일 마감 ${tomorrow}건이에요.`,
    stamp: `${hourMinuteText(asOf)} 기준 · ${marketStamp(response.marketPick)}`,
    ...columnsOf(response.marketPick),
    groups: [...groups.values()]
  };
}
