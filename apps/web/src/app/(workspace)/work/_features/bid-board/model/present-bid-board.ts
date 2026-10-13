/**
 * @module 책임: 오늘 투찰 응답을 마감 묶음·행·방법별 금액 칸·머리 문장으로 바꾸는 표시 모델을 소유한다.
 *
 * 방법을 하나로 고르지 않고 이름 붙여 나란히 둔다(PDR-0008). 근거가 가장 강한 칸에만 표시를 단다 — 아침 갱신이 켜지면 그 칸,
 * 아니면 맞춤이 나오면 맞춤, 아니면 전국 공식. 금액은 문자열 그대로 자릿수를 끊고 Number로 바꾸지 않는다(AGENTS 15). 확률은 보이지 않는다.
 * 더 보기 안의 설명과 성적은 `row-more.ts`가 만든다.
 */
import type { BidBoardRowWire, MyBidBoardV1Response } from '@eatbid/contracts/api/v1/me';

import { decimalScale, scaledText, sumAtScale } from '@/shared/lib/decimal-sum';
import { amountLine, type AmountLine } from './amount-line';
import { groupLabel, hourMinuteText, kstOf, relativeText } from './closing-time';
import { habitCellOf, habitGuide, habitHeadRecord, habitHeadSample, habitRecordText, type HabitCellView } from './morning-habit-cell';
import { EMPTY_MORE, moreOf, recordOf, ruleBasisText, type BoardRecord, type MarketWords, type RowMore } from './row-more';

export type { AmountLine } from './amount-line';

type Confirmed = Extract<MyBidBoardV1Response, { regionPreference: 'confirmed' }>;
type MarketHead = Confirmed['marketPick'];
type HabitHead = Confirmed['morningHabit'];
type MarketCell = NonNullable<BidBoardRowWire['market']>;
type RuleCell = NonNullable<BidBoardRowWire['rule']>;

export type AmountCell =
  | {
      readonly kind: 'amounts';
      readonly lead: boolean;
      readonly lines: readonly AmountLine[];
      /** 아침 갱신 칸만 쓴다 — 몇 시 결과로 바뀌었는지다. */
      readonly note?: string;
    }
  | { readonly kind: 'reason'; readonly text: string };

export interface BoardRowView {
  readonly auctionId: string;
  readonly href: `/auctions/${string}`;
  readonly organization: string;
  /** 관측되지 않았으면 비운다. "품목 미상"·"제목 미관측" 같은 빈칸 말을 행마다 늘어놓지 않는다. */
  readonly item: string | null;
  readonly title: string | null;
  /** eaT에서 공고를 찾는 번호다. 같은 학교의 비슷한 공고가 같은 시각에 몰릴 때 다른 공고에 넣는 사고를 막는다. */
  readonly bidNo: string | null;
  /** 라벨과 값을 나눈다. 값이 라벨보다 진해야 eaT 화면과 같은 공고인지 맞춰 볼 수 있다. */
  readonly facts: readonly { readonly label: string; readonly value: string }[];
  /** 하한율 88% 공고다. 금액 없이 직접 판단으로 표시한다(PDR-0008). */
  readonly selfJudged: boolean;
  /** [아침 갱신(요청했을 때만), 이번 달 맞춤, 전국 공식] 순서가 고정이다. 직접 판단 행은 비어 있다. */
  readonly cells: readonly AmountCell[];
  /** 모든 칸이 같은 이유로 비었으면 칸마다 같은 말을 되풀이하지 않고 한 줄로 말한다. */
  readonly sharedReason: string | null;
  readonly more: RowMore;
}

export interface ClosingGroupView {
  readonly label: string;
  /** 오늘 마감 묶음만 남은 시간을 단다. 내일 묶음은 이름이 이미 "내일 · "로 시작한다. */
  readonly relative: string | null;
  readonly rows: readonly BoardRowView[];
}

export interface BoardColumn {
  readonly label: string;
  /** 지난 공고에 대어 본 낙찰 수다. 아침 갱신은 맞춤보다 늘어난 수다. */
  readonly record: string;
  /** 그 수를 잰 공고 수와 조건이다. */
  readonly sample: string;
}

export type BoardView =
  | { readonly kind: 'region-unconfirmed' }
  | {
    readonly kind: 'board';
    readonly lede: string;
    readonly stamp: string;
    readonly columns: readonly BoardColumn[];
    /** 금액 칸 수다. 아침 갱신이 실린 응답이면 3이다 — 화면이 격자를 바꾼다. */
    readonly methods: 2 | 3;
    readonly columnCaption: string;
    readonly groups: readonly ClosingGroupView[];
    readonly record: BoardRecord;
    readonly ruleBasis: string;
    /** 목록이 쪽 상한에 닿아 늦게 마감하는 공고 일부가 빠졌을 때만 있다. */
    readonly truncatedNote: string | null;
    readonly guide: readonly string[];
  };

const GROUPING = /\B(?=(\d{3})+(?!\d))/g;
const wholeWon = (amount: string) => amount.split('.')[0]!;
const wonText = (amount: string) => `${wholeWon(amount).replace(GROUPING, ',')}원`;

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

/** 칸 셋이 모두 같은 이유로 비었을 때 한 줄로 쓰는 문장이다. 금액을 못 낸 까닭이 공고 쪽 빈칸일 때만 묶는다. */
const SHARED_REASONS: Readonly<Record<string, string>> = {
  '하한율 미확인': '하한율이 아직 안 나와 금액을 내지 않았어요',
  '기초금액 미확인': '기초금액이 아직 안 나와 금액을 내지 않았어요'
};

function marketMonth(head: MarketHead): number {
  const month = Number(head.window.throughMonth.slice(5, 7));
  return month === 12 ? 1 : month + 1;
}

function marketWords(head: MarketHead): MarketWords {
  const window = `${Number(head.window.fromMonth.slice(5, 7))}~${Number(head.window.throughMonth.slice(5, 7))}월`;
  return {
    name: `${marketMonth(head)}월 맞춤`,
    source: `${window} 내 사업자 공고 ${(head.marketRounds ?? 0).toLocaleString('ko-KR')}건`
  };
}

function marketStamp(head: MarketHead, words: MarketWords): string {
  if (head.state === 'picked') return `${words.name} 금액은 ${words.source}으로 골랐어요`;
  if (head.reasons.includes('market-rounds-below-minimum')) {
    return `최근 석 달 내 사업자 공고가 ${(head.marketRounds ?? 0).toLocaleString('ko-KR')}건이라 맞춤 금액을 고르지 않았어요(${head.minimumRounds}건 이상 필요)`;
  }
  if (head.reasons.includes('no-linked-business')) return '내 사업자에 등록한 업체가 개찰 기록에서 아직 확인되지 않아 맞춤 금액이 없어요';
  return '지금은 맞춤 금액을 계산하지 못했어요. 잠시 뒤 새로고침해 주세요.';
}

function columnsOf(head: MarketHead, habit: HabitHead, words: MarketWords) {
  const sum = (field: 'expectedWins' | 'ruleExpectedWins') => {
    const values = head.evidence.map((entry) => entry[field]);
    const scale = decimalScale(values);
    return `${scaledText(sumAtScale(values, scale), scale)}건`;
  };
  const rounds = `${head.evidence.reduce((total, entry) => total + entry.rounds, 0).toLocaleString('ko-KR')}건`;
  const shared = [
    { label: words.name, record: sum('expectedWins'), sample: rounds },
    { label: '전국 공식', record: sum('ruleExpectedWins'), sample: rounds }
  ];
  // 아침 갱신 성적은 다른 공고 수와 조건으로 쟀으므로 칸마다 잰 공고 수를 붙인다. 한 줄 설명으로 묶으면 다른 표본을 나란히 견주게 된다.
  return habit === undefined
    ? { methods: 2 as const, columns: shared }
    : { methods: 3 as const, columns: [{ label: '아침 갱신', record: habitHeadRecord(habit), sample: habitHeadSample(habit) }, ...shared] };
}

function marketCellOf(row: BidBoardRowWire, leadTaken: boolean): AmountCell {
  if (row.market === null) return { kind: 'reason', text: '기초금액 미확인' };
  if (row.market.state === 'not-applicable') {
    return { kind: 'reason', text: row.market.reasons.map((reason) => MARKET_REASONS[reason]).join(' · ') };
  }
  const floor = row.floorRate?.value ?? null;
  return { kind: 'amounts', lead: !leadTaken, lines: row.market.positions.map((position) => amountLine(`${position.order}번`, position, floor)) };
}

function ruleCellOf(row: BidBoardRowWire, leadTaken: boolean): AmountCell {
  if (row.rule === null) return { kind: 'reason', text: '기초금액 미확인' };
  if (row.rule.state === 'not-applicable') {
    return { kind: 'reason', text: row.rule.reasons.map((reason) => RULE_REASONS[reason]).join(' · ') };
  }
  return {
    kind: 'amounts',
    lead: !leadTaken,
    lines: row.rule.positions.slice(0, 2).map((position) => amountLine(`${position.order}번`, position, row.floorRate?.value ?? null))
  };
}

function sharedReasonOf(cells: readonly AmountCell[]): string | null {
  const texts = new Set(cells.map((cell) => (cell.kind === 'reason' ? cell.text : null)));
  if (texts.size !== 1) return null;
  const [text] = texts;
  return text === null || text === undefined ? null : SHARED_REASONS[text] ?? null;
}

function rowOf(row: BidBoardRowWire, head: MarketHead, habit: HabitHead, words: MarketWords, habitView: HabitCellView | null): BoardRowView {
  const selfJudged = row.floorRate?.value === '88.000';
  const morning: AmountCell | null = habitView === null ? null
    : habitView.kind === 'reason' ? { kind: 'reason', text: habitView.text }
    : { kind: 'amounts', lead: true, lines: habitView.lines, note: habitView.note };
  const habitLead = morning?.kind === 'amounts';
  const market = marketCellOf(row, habitLead);
  const marketLead = market.kind === 'amounts';
  const cells = selfJudged ? [] : [...(morning === null ? [] : [morning]), market, ruleCellOf(row, habitLead || marketLead)];
  const sharedReason = sharedReasonOf(cells);
  return {
    auctionId: row.auctionId,
    href: `/auctions/${encodeURIComponent(row.auctionId)}`,
    organization: row.organizationLabel ?? '기관 이름 미확인',
    item: row.itemLabel === null ? null : row.itemLabel.split(',').map((part) => part.trim()).filter(Boolean).join(' · '),
    title: row.title,
    bidNo: row.displayBidNo,
    facts: [
      { label: '기초금액', value: row.baseAmount === null ? '미확인' : wonText(row.baseAmount.amount) },
      { label: '참여', value: row.bidCount === null ? '미확인' : `${row.bidCount.toLocaleString('ko-KR')}곳` }
    ],
    selfJudged,
    cells,
    sharedReason,
    // 금액이 하나도 없는 행은 더 보기에 볼 근거·예비 순위가 없다.
    more: selfJudged || sharedReason !== null ? EMPTY_MORE : moreOf(row, head, words, habit === undefined || habitView === null ? null : {
      text: habitView.detail,
      record: habitRecordText(habit, words.name)
    })
  };
}

/**
 * 머리 문장이다. 아침 갱신이 실렸으면 이 화면을 언제 다시 열지를 같이 말한다 — 전날 저녁에는 칸이 비어 있고 당일 아침에 결과가
 * 나와야 금액이 생기므로, 그 사실을 칸 하나하나가 아니라 맨 위 한 문장에서 먼저 안다.
 */
function ledeOf(today: number, tomorrow: number, habitViews: readonly HabitCellView[] | null): string {
  if (today + tomorrow === 0) return '오늘·내일 마감 공고가 없어요.';
  const base = `오늘 마감 ${today}건, 내일 마감 ${tomorrow}건이에요.`;
  if (habitViews === null) return base;
  const moved = habitViews.filter((view) => view.kind === 'amounts').length;
  if (moved > 0) return `${base} 아침 결과로 ${moved}건의 금액을 다시 골랐어요.`;
  const waiting = habitViews.filter((view) => view.kind === 'reason' && view.tomorrow).length;
  return waiting > 0 ? `${base} 내일 마감 ${waiting}건은 내일 아침에 다시 열면 아침 갱신 금액이 생길 수 있어요.` : base;
}

function guideOf(words: MarketWords, habit: HabitHead): readonly string[] {
  const order = habit === undefined
    ? `${words.name}이 나오면 그 칸, 아니면 전국 공식이에요.`
    : `아침 갱신이 켜지면 그 칸, 아니면 ${words.name}, 그것도 없으면 전국 공식이에요.`;
  return [
    `방법마다 1번·2번 사정률을 냈어요. 큰 숫자가 eaT에 넣는 사정률이고, 아래 작은 줄은 기초금액 대비 %와 확인용 금액이에요. 파란 테두리가 지금 근거가 가장 강한 방법이에요 — ${order}`,
    ...(habit === undefined ? [] : [habitGuide(habit)]),
    '더 보기의 성적은 지난 공고에 1번·2번을 넣었다고 치고 센 낙찰 수예요(예정가격 추첨 평균). 넓은 화면에서는 방법 이름 줄에도 같은 수가 있어요.',
    '숫자 옆 복사를 누르면 그 숫자가 복사돼요. 넣을지와 언제 넣을지는 직접 정하세요.',
    '하한율 88% 공고는 금액 없이 직접 판단만 달아요.'
  ];
}

export function presentBidBoard(response: MyBidBoardV1Response): BoardView {
  // 관심 지역이 확인된 응답만 맞춤 방법 머리를 싣는다. 확인 여부 필드를 문자열로 비교하면 지역 어휘 검사가 지역 이름 비교로 읽는다.
  if (!('marketPick' in response)) return { kind: 'region-unconfirmed' };
  const asOf = kstOf(response.asOf);
  const words = marketWords(response.marketPick);
  const habit = response.morningHabit;
  const groups = new Map<string, { label: string; relative: string | null; rows: BoardRowView[] }>();
  const habitViews: HabitCellView[] = [];
  let today = 0;
  let tomorrow = 0;
  // 서버가 마감 순으로 준다. 같은 마감 시각끼리 한 묶음이다.
  for (const row of response.rows) {
    if (row.closesAt === null) continue;
    const closes = kstOf(row.closesAt);
    if (closes.toPlainDate().equals(asOf.toPlainDate())) today += 1;
    else tomorrow += 1;
    const habitView = habit === undefined || row.floorRate?.value === '88.000' ? null : habitCellOf(row, response.asOf);
    if (habitView !== null) habitViews.push(habitView);
    const key = closes.toString();
    const group = groups.get(key) ?? { label: groupLabel(asOf, closes), relative: relativeText(asOf, closes), rows: [] };
    group.rows.push(rowOf(row, response.marketPick, habit, words, habitView));
    groups.set(key, group);
  }
  return {
    kind: 'board',
    lede: ledeOf(today, tomorrow, habit === undefined ? null : habitViews),
    stamp: `${hourMinuteText(asOf)} 기준 · ${marketStamp(response.marketPick, words)}`,
    ...columnsOf(response.marketPick, habit, words),
    columnCaption: '지난 공고에 1번·2번을 넣었다고 치고 센 낙찰 수',
    groups: [...groups.values()],
    record: recordOf(response.marketPick, words),
    ruleBasis: ruleBasisText(response.rule),
    truncatedNote: response.truncated ? '공고가 많아 늦게 마감하는 공고 일부를 불러오지 못했어요. 품목을 골라 좁혀 보세요.' : null,
    guide: guideOf(words, habit)
  };
}
