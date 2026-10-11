/**
 * @module 책임: 오늘 투찰 한 줄의 아침 갱신 칸(켜지면 1번·2번과 반영 시각, 꺼지면 짧은 이유)과 그 열 머리 성적을 만드는 표시 모델을
 * 소유한다.
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

export type HabitCellView =
  | { readonly kind: 'amounts'; readonly lines: readonly HabitAmountLine[]; readonly note: string }
  | { readonly kind: 'reason'; readonly text: string };

function clockText(instant: string): string {
  const time = Temporal.Instant.from(instant).toZonedDateTimeISO(KST);
  return `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`;
}

/**
 * 오늘 자리가 하나도 안 보인 칸은 마감일로 이유를 가른다. 내일 마감 공고는 내일 아침 결과를 기다려야 하고, 오늘 마감 공고는 그날
 * 앞선 개찰 결과를 기다리는 중이다. 조금 보였지만 문턱 아래면 "오늘 정보 부족"이다(시안 W1).
 */
function coverageReason(cell: Extract<HabitCell, { state: 'not-applicable' }>, closesAt: string | null, asOf: string): string {
  const seen = cell.coverage !== null && cell.coverage.value !== '0.000000';
  if (seen) return '오늘 정보 부족';
  if (closesAt === null) return '앞선 결과 기다리는 중';
  const closingDay = Temporal.Instant.from(closesAt).toZonedDateTimeISO(KST).toPlainDate();
  const today = Temporal.Instant.from(asOf).toZonedDateTimeISO(KST).toPlainDate();
  return Temporal.PlainDate.compare(closingDay, today) > 0 ? '내일 아침 계산' : '앞선 결과 기다리는 중';
}

export function habitCellOf(row: BidBoardRowWire, asOf: string): HabitCellView {
  const cell = row.morningHabit;
  if (cell === undefined || cell === null) return { kind: 'reason', text: '기초금액 미확인' };
  if (cell.state === 'not-applicable') {
    if (cell.reasons.includes('same-day-coverage-below-threshold')) {
      return { kind: 'reason', text: coverageReason(cell, row.closesAt, asOf) };
    }
    return {
      kind: 'reason',
      text: cell.reasons
        .filter((reason): reason is Exclude<Reason, 'same-day-coverage-below-threshold'> => reason !== 'same-day-coverage-below-threshold')
        .map((reason) => REASONS[reason])
        .join(' · ')
    };
  }
  const floor = row.floorRate?.value ?? null;
  return {
    kind: 'amounts',
    lines: cell.positions.map((position) => ({ label: `${position.order}번`, figure: bidFigure(position, floor) })),
    note:
      cell.latestSameDayOpenedAt === null
        ? `단골 ${cell.sameDayRegulars}곳 반영`
        : `${clockText(cell.latestSameDayOpenedAt)} 결과로 바뀜 · 단골 ${cell.sameDayRegulars}곳`
  };
}

/** 소수 한 자리 문자열을 정수 십분의 일로 읽는다. 표시용 합만 낸다. */
function tenths(value: string): number {
  const [whole, fraction = '0'] = value.split('.');
  return Number(whole) * 10 + Number(fraction.slice(0, 1));
}

/** 열 머리 성적이다. 아침 갱신은 같은 공고에서 맞춤보다 늘어난 낙찰 수와 그 공고 수다(시안 W1). */
export function habitHeadRecord(head: HabitHead): string {
  const rounds = head.evidence.reduce((sum, entry) => sum + entry.rounds, 0);
  const gain = head.evidence.reduce((sum, entry) => sum + tenths(entry.expectedWins) - tenths(entry.monthlyExpectedWins), 0);
  const sign = gain >= 0 ? '+' : '−';
  const absolute = Math.abs(gain);
  return `${sign}${Math.floor(absolute / 10)}.${absolute % 10}건/${rounds.toLocaleString('ko-KR')}건`;
}

export function habitGuide(head: HabitHead): string {
  return (
    '아침 갱신은 오늘 먼저 개찰된 공고에서 단골 업체가 넣은 사정률을 보고 다시 고른 금액이에요. ' +
    `마감 ${head.validatedLeadMinutes}분 전에 넣을 때로 검증했고, 결과가 더 나오면 바뀌니 넣기 직전에 새로고침하세요. ` +
    '칸 머리 숫자는 같은 공고에서 맞춤보다 늘어난 낙찰 수예요.'
  );
}
