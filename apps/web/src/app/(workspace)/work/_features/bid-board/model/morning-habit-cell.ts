/**
 * @module 책임: 오늘 투찰 한 줄의 아침 갱신 칸(켜지면 1번·2번과 반영 시각, 꺼지면 짧은 이유)과 더 보기 설명, 열 머리 성적을 만드는
 * 표시 모델을 소유한다.
 *
 * 맞춤·전국 공식 칸(`present-bid-board.ts`)과 나눈 이유는 바뀌는 이유가 달라서다. 이 칸은 화면을 연 시각까지 보인 결과로
 * 계산되어 결과가 더 나오면 바뀌므로, 몇 시 결과까지 반영했는지와 왜 아직 꺼져 있는지를 칸 안에서 말한다(ADR 0067).
 */
import { Temporal } from '@eatbid/domain';
import type { BidBoardRowWire, MyBidBoardV1Response } from '@eatbid/contracts/api/v1/me';

import { bidFigure } from '@/entities/bid-figure/bid-figure';

type Confirmed = Extract<MyBidBoardV1Response, { regionPreference: 'confirmed' }>;
type HabitHead = NonNullable<Confirmed['morningHabit']>;
type HabitCell = NonNullable<BidBoardRowWire['morningHabit']>;
type Reason = Extract<HabitCell, { state: 'not-applicable' }>['reasons'][number];

const KST = 'Asia/Seoul';

const REASONS: Record<Exclude<Reason, 'same-day-coverage-below-threshold'>, string> = {
  'floor-rate-unobserved': '하한율 미확인',
  'floor-rate-outside-habit-pick': '하한율 90%만',
  'no-linked-business': '등록 업체 미확인',
  'market-rounds-below-minimum': '단골 판단 공고 부족',
  'market-data-unavailable': '지금은 계산하지 못했어요',
  'deadline-unobserved': '마감 미확인',
  'deadline-passed': '지났어요',
  'participation-unobserved': '참여 수 미확인'
};

export interface HabitAmountLine {
  readonly label: string;
  readonly figure: ReturnType<typeof bidFigure>;
}

/** `detail`은 더 보기의 아침 갱신 상자에 쓰는 한두 문장이다. 칸에는 짧게, 상자에는 왜·언제를 쓴다. */
export type HabitCellView =
  | { readonly kind: 'amounts'; readonly lines: readonly HabitAmountLine[]; readonly note: string; readonly detail: string }
  | {
      readonly kind: 'reason';
      readonly text: string;
      readonly detail: string;
      /** 내일 아침 결과를 기다리는 칸이다. 머리 문장이 "내일 아침에 다시 열면"을 몇 건인지 센다. */
      /** 마감이 오늘보다 뒤라 그날 아침에 다시 열어야 하는 칸이다. */
      readonly later: boolean;
    };

function clockText(instant: string): string {
  const time = Temporal.Instant.from(instant).toZonedDateTimeISO(KST);
  return `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`;
}

/** 꺼져 있는 동안 파란 테두리가 다른 칸에 있다고 같이 말한다. 상자만 읽은 사람도 지금 어느 칸을 보면 되는지 안다. */
const MEANWHILE = '그 전까지는 파란 테두리가 다른 칸에 있어요.';

/**
 * 오늘 자리가 하나도 안 보인 칸은 마감일로 이유를 가른다. 내일 마감 공고는 내일 아침 결과를 기다려야 하고, 오늘 마감 공고는 그날
 * 앞선 개찰 결과를 기다리는 중이다. 조금 보였지만 문턱 아래면 단골 결과가 아직 적은 것이다(시안 W1).
 *
 * 내일 칸은 언제 다시 열면 되는지를 말한다. 사장님은 마감 전날 저녁에 넣어 와서(2024~2026 실측) 이 칸이 비어 있는 이유와 다시 볼
 * 시각을 모르면 이 방법을 쓸 길이 없다.
 */
function coverageReason(cell: Extract<HabitCell, { state: 'not-applicable' }>, closesAt: string | null, asOf: string) {
  const seen = cell.coverage !== null && cell.coverage.value !== '0.000000';
  if (seen) {
    return { text: '단골 결과가 아직 적어요', detail: `오늘 단골 결과가 아직 적어 금액을 내지 않았어요. 결과가 더 나오면 생길 수 있어요. ${MEANWHILE}`, later: false };
  }
  const waiting = { text: '앞선 결과 기다리는 중', detail: `오늘 앞서 개찰되는 공고의 결과가 나오면 금액이 생겨요. ${MEANWHILE}`, later: false };
  if (closesAt === null) return waiting;
  const closingDay = Temporal.Instant.from(closesAt).toZonedDateTimeISO(KST).toPlainDate();
  const today = Temporal.Instant.from(asOf).toZonedDateTimeISO(KST).toPlainDate();
  if (Temporal.PlainDate.compare(closingDay, today) <= 0) return waiting;
  if (today.add({ days: 1 }).equals(closingDay)) {
    return {
      text: '내일 아침에 다시 열면 계산돼요',
      detail: `내일 아침 그날 앞선 공고의 결과가 나오면 금액이 생겨요. 지금은 전날이라 볼 결과가 없어요. ${MEANWHILE}`,
      later: true
    };
  }
  return {
    text: '마감 날 아침에 다시 열면 계산돼요',
    detail: `마감 날 아침 그날 앞선 공고의 결과가 나오면 금액이 생겨요. 지금은 그 전이라 볼 결과가 없어요. ${MEANWHILE}`,
    later: true
  };
}

export function habitCellOf(row: BidBoardRowWire, asOf: string): HabitCellView {
  const cell = row.morningHabit;
  if (cell === undefined || cell === null) {
    return { kind: 'reason', text: '기초금액 미확인', detail: '기초금액이 아직 나오지 않아 금액을 내지 않았어요.', later: false };
  }
  if (cell.state === 'not-applicable') {
    if (cell.reasons.includes('same-day-coverage-below-threshold')) {
      return { kind: 'reason', ...coverageReason(cell, row.closesAt, asOf) };
    }
    const text = cell.reasons
      .filter((reason): reason is Exclude<Reason, 'same-day-coverage-below-threshold'> => reason !== 'same-day-coverage-below-threshold')
      .map((reason) => REASONS[reason])
      .join(' · ');
    return { kind: 'reason', text, detail: `이 공고에는 아침 갱신 금액이 없어요(${text}).`, later: false };
  }
  const floor = row.floorRate?.value ?? null;
  const seenAt = cell.latestSameDayOpenedAt === null ? null : clockText(cell.latestSameDayOpenedAt);
  return {
    kind: 'amounts',
    lines: cell.positions.map((position) => ({ label: `${position.order}번`, figure: bidFigure(position, floor) })),
    note: seenAt === null ? `단골 ${cell.sameDayRegulars}곳 반영` : `${seenAt} 결과로 바뀜 · 단골 ${cell.sameDayRegulars}곳`,
    detail:
      `${seenAt === null ? '지금까지 나온' : `${seenAt}까지 나온`} 오늘 결과에서 단골 ${cell.sameDayRegulars}곳이 넣은 사정률을 보고 다시 고른 금액이에요. ` +
      '결과가 더 나오면 바뀌니 넣기 직전에 새로고침해 보세요.'
  };
}

/** 소수 한 자리 문자열을 정수 십분의 일로 읽는다. 표시용 합만 낸다. */
function tenths(value: string): number {
  const [whole, fraction = '0'] = value.split('.');
  return Number(whole) * 10 + Number(fraction.slice(0, 1));
}

const tenthsText = (value: number) => `${Math.floor(value / 10)}.${value % 10}`;

function totals(head: HabitHead) {
  return {
    rounds: head.evidence.reduce((sum, entry) => sum + entry.rounds, 0),
    habit: head.evidence.reduce((sum, entry) => sum + tenths(entry.expectedWins), 0),
    monthly: head.evidence.reduce((sum, entry) => sum + tenths(entry.monthlyExpectedWins), 0)
  };
}

/**
 * 열 머리 성적이다. 아침 갱신은 같은 공고에서 맞춤보다 늘어난 낙찰 수다(시안 W1). 옆 칸의 전체 낙찰 수(95건)와 나란히 두면 작아
 * 보이므로 "맞춤보다"를 붙여 무엇과 견준 수인지 말한다.
 */
export function habitHeadRecord(head: HabitHead): string {
  const { habit, monthly } = totals(head);
  const gain = habit - monthly;
  return `맞춤보다 ${gain >= 0 ? '+' : '−'}${tenthsText(Math.abs(gain))}건`;
}

/** 성적을 잰 조건과 공고 수다. 마감 직전에 넣는다는 전제를 숫자 바로 아래에 둔다 — 전날 넣는 공고에는 이 차이가 없다. */
export function habitHeadSample(head: HabitHead): string {
  return `마감 ${head.validatedLeadMinutes}분 전 기준 · ${totals(head).rounds.toLocaleString('ko-KR')}건`;
}

const yearMonthText = (month: string) => `${month.slice(0, 4)}년 ${Number(month.slice(5, 7))}월`;

/**
 * 더 보기 상자의 성적 문장이다. 두 방법을 같은 공고 묶음에서 센 수만 기준 → 아침 갱신 순으로 묶는다. 바로 위 성적 막대는 다른 공고
 * 묶음(맞춤 표본)이라 같은 맞춤이 다른 숫자를 갖는다 — 그 사실을 문장에서 말해 두 숫자를 견주지 않게 한다. 잰 기간을 단다(AGENTS 7).
 */
export function habitRecordText(head: HabitHead, monthlyLabel: string): string {
  const { rounds, habit, monthly } = totals(head);
  const gain = habit - monthly;
  const period = `${yearMonthText(head.evidence[0]!.from)}~${yearMonthText(head.evidence.at(-1)!.through)}`;
  return (
    `${period} 공고 ${rounds.toLocaleString('ko-KR')}건에 마감 ${head.validatedLeadMinutes}분 전에 1번·2번을 넣었다고 치고 세면 ` +
    `${monthlyLabel} ${tenthsText(monthly)}건 → 아침 갱신 ${tenthsText(habit)}건(${gain >= 0 ? '+' : '−'}${tenthsText(Math.abs(gain))}건)이에요. ` +
    `위 성적 막대와는 센 공고가 달라요(계산 ${head.version}).`
  );
}

export function habitGuide(head: HabitHead): string {
  return (
    '아침 갱신은 그날 먼저 개찰된 공고에서 단골 업체가 넣은 사정률을 보고 다시 고른 금액이에요. 그날 결과가 나와야 계산돼서 ' +
    `전날 저녁에는 비어 있어요. 성적은 마감 ${head.validatedLeadMinutes}분 전에 넣었다고 치고 센 것이라, 전날 넣는 공고에는 이 차이가 ` +
    '해당하지 않아요.'
  );
}
