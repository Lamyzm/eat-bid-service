/**
 * @module 책임: 아침 갱신(오늘 먼저 개찰된 공고의 단골 자리로 다시 고른 금액) 응답을 금액·반영 상태·검증 전제·비교 성적 문장으로
 * 바꾸는 표시 모델을 소유한다.
 *
 * 이 금액은 사용자가 화면을 연 시각까지 보인 결과로 계산되어 결과가 더 나오면 바뀐다. 그래서 "몇 시 결과까지 반영했는지"와
 * "언제 넣을 때로 검증했는지"를 금액과 늘 함께 쓴다(ADR 0067). 꺼진 공고는 금액 없이 이유만 쓴다 — 이번 달 맞춤이 대신한다.
 */
import { Temporal } from '@eatbid/domain';
import type { AuctionBidPositionV1Response } from '@eatbid/contracts/api/v1/auctions';

import { bidFigure } from '@/entities/bid-figure/bid-figure';
import type { MarketPickRow } from './present-market-pick';

type MorningHabit = NonNullable<AuctionBidPositionV1Response['morningHabit']>;
type Applicable = Extract<MorningHabit['result'], { state: 'applicable' }>;
type Reason = Extract<MorningHabit['result'], { state: 'not-applicable' }>['reasons'][number];

export type MorningHabitView =
  | { readonly kind: 'off'; readonly status: string }
  | {
      readonly kind: 'on';
      readonly status: string;
      readonly rows: readonly MarketPickRow[];
      readonly single: MarketPickRow | null;
      readonly premise: string;
      readonly evidence: string;
    };

const KST = 'Asia/Seoul';

function clockText(instant: string): string {
  const time = Temporal.Instant.from(instant).toZonedDateTimeISO(KST);
  return `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`;
}

/** ratio(0~1, 여섯째 자리)를 정수 %로 내림한다. 30% 문턱 바로 아래를 30%로 올려 보이지 않게 한다. */
function percentFloor(ratio: { readonly value: string }): string {
  const [whole, fraction = ''] = ratio.value.split('.');
  return `${Number(whole) * 100 + Number(fraction.padEnd(2, '0').slice(0, 2))}%`;
}

function reasonText(reasons: readonly Reason[], coverage: { readonly value: string } | null, threshold: string): string {
  const text: Record<Reason, string> = {
    'floor-rate-unobserved': '낙찰하한율을 아직 확인하지 못했어요.',
    'floor-rate-outside-habit-pick': '아침 갱신은 하한율 90% 공고에서만 검증했어요.',
    'no-linked-business': '내 사업자에 등록한 업체가 개찰 기록에서 아직 확인되지 않았어요.',
    'market-rounds-below-minimum': '최근 180일 내 사업자가 넣은 공고가 30건보다 적어 단골 업체를 정하지 못했어요.',
    'market-data-unavailable': '지금은 아침 갱신을 계산하지 못했어요. 잠시 뒤 새로고침해 주세요.',
    'deadline-unobserved': '마감 시각을 아직 확인하지 못했어요.',
    'deadline-passed': '마감이 지난 공고예요.',
    'participation-unobserved': '참여 업체 수를 아직 확인하지 못했어요.',
    'same-day-coverage-below-threshold':
      `오늘 정보 부족 — 단골 업체의 오늘 자리가 ${coverage === null ? '아직' : percentFloor(coverage) + '만'} ` +
      `보였어요(${threshold} 이상이면 켜져요). 지금은 아래 이번 달 맞춤을 보세요.`
  };
  return reasons.map((reason) => text[reason]).join(' ');
}

function statusText(habit: MorningHabit, result: Applicable): string {
  const latest =
    result.latestSameDayOpenedAt === null ? '' : `${clockText(result.latestSameDayOpenedAt)} 개찰 결과까지 반영 · `;
  return (
    `${latest}단골 ${result.regulars.toLocaleString('ko-KR')}곳 중 ` +
    `${result.sameDayRegulars.toLocaleString('ko-KR')}곳의 오늘 자리를 봤어요 · ${clockText(habit.decidedAt)} 기준`
  );
}

/** 소수 한 자리 문자열 합을 정수 십분의 일로 더한다. */
function tenths(value: string): number {
  const [whole, fraction = '0'] = value.split('.');
  return Number(whole) * 10 + Number(fraction.slice(0, 1));
}

function tenthsText(value: number): string {
  return `${Math.floor(value / 10)}.${value % 10}`;
}

function monthText(month: string): string {
  return `${month.slice(0, 4)}년 ${Number(month.slice(5, 7))}월`;
}

function evidenceText(habit: MorningHabit): string {
  const first = habit.evidence[0]!;
  const last = habit.evidence.at(-1)!;
  const rounds = habit.evidence.reduce((sum, entry) => sum + entry.rounds, 0);
  const monthly = habit.evidence.reduce((sum, entry) => sum + tenths(entry.monthlyExpectedWins), 0);
  const morning = habit.evidence.reduce((sum, entry) => sum + tenths(entry.expectedWins), 0);
  const gain = Math.round(((morning - monthly) / monthly) * 1000) / 10;
  return (
    `같은 시장 공고 ${rounds.toLocaleString('ko-KR')}건(${monthText(first.from)}~${monthText(last.through)})에 대어 본 ` +
    `낙찰 수예요(두 장, 예정가격 추첨 평균). 이번 달 맞춤만 쓰면 ${tenthsText(monthly)}건, 켜진 공고를 아침 갱신으로 ` +
    `바꾸면 ${tenthsText(morning)}건(${gain >= 0 ? '+' : ''}${gain}%)이에요. 아래 막대와는 공고 수가 달라 직접 견주지 마세요.`
  );
}

/** 사업자가 하나면 두 장 금액이 곧 한 장 금액이라 따로 보이지 않는다. 1번과 같으면 같다고 적는다. */
function singleRow(result: Applicable, floorRate: string | null): MarketPickRow | null {
  if (result.positions.length < 2) return null;
  const row = { label: '한 곳만 넣을 때', figure: bidFigure(result.single, floorRate), note: null };
  return result.single.amount.amount === result.positions[0]!.amount.amount ? { ...row, note: '1번과 같은 금액' } : row;
}

export function presentMorningHabit(habit: MorningHabit, floorRate: string | null): MorningHabitView {
  const { result } = habit;
  const threshold = percentFloor(habit.coverageThreshold);
  if (result.state === 'not-applicable') {
    return { kind: 'off', status: reasonText(result.reasons, result.coverage, threshold) };
  }
  return {
    kind: 'on',
    status: statusText(habit, result),
    rows: result.positions.map((position) => ({
      label: `${position.order}번 사업자`,
      figure: bidFigure(position, floorRate),
      note: null
    })),
    single: singleRow(result, floorRate),
    premise:
      `마감 ${habit.validatedLeadMinutes}분 전에 넣을 때를 기준으로 검증했어요. 결과가 더 나오면 금액이 바뀔 수 있으니 ` +
      `넣기 직전에 새로고침해 주세요.`,
    evidence: evidenceText(habit)
  };
}
