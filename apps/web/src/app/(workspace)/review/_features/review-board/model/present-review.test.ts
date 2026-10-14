import { describe, expect, test } from 'bun:test';

import { findBannedCopy } from '@/app/(workspace)/auctions/[auctionId]/__fixtures__/banned-copy';
import { bidReview } from '@/app/(workspace)/review/__fixtures__/bid-review';
import { assessmentText, axisPosition, presentReview } from './present-review';

function reviewView() {
  const view = presentReview(bidReview);
  if (view.kind !== 'review') throw new Error('복기가 있어야 한다');
  return view;
}

describe('복기 표시', () => {
  test('비율을 사정률 소수 셋째 자리로 반올림하고 눈금자 자리로 옮긴다', () => {
    expect(assessmentText('1.009115')).toBe('100.912');
    expect(assessmentText('0.984900')).toBe('98.490');
    expect(axisPosition('0.975000')).toBe(0);
    expect(axisPosition('1.020000')).toBe(100);
    expect(axisPosition('0.997500')).toBeCloseTo(50, 6);
  });

  test('연도는 최근 해부터, 달 탭은 고른 해의 달만 보이고 낙찰 수를 함께 단다', () => {
    const view = reviewView();
    expect(view.years).toEqual([{ year: '2026', latestMonth: '2026-09' }, { year: '2025', latestMonth: '2025-12' }]);
    expect(view.monthTabs.map((tab) => [tab.label, tab.rounds, tab.wins])).toEqual([['8월', 73, 1], ['9월', 3, 1]]);
  });

  test('머리 문장은 실제 낙찰 수와 맞춤이 1등 자리에 든 공고 수를 말한다', () => {
    expect(reviewView().lede).toBe('9월 공고 3건에 내 사업자가 넣었고, 실제 낙찰은 1건이에요. 같은 공고에서 맞춤 값이 1등 자리에 든 공고는 1건이에요.');
  });

  test('성적 표는 방법마다 이름·출처와 기대를 쓰고, 기대가 가장 높은 방법 하나에 표시를 단다', () => {
    const rows = reviewView().summary;
    expect(rows.map((row) => [row.name, row.values, row.first, row.firstNote, row.expected, row.lead, row.empty])).toEqual([
      ['실제 낸 값', '공고마다', 1, '실제 낙찰 1', '0.3', false, false],
      ['9월 맞춤', '98.490 / 98.940', 1, null, '0.5', true, false],
      ['전국 공식', '참여 수별', 0, null, '0.2', false, false],
      ['아침 갱신', '–', 0, null, '0.0', false, true]
    ]);
    expect(rows[0]!.note).toBe('내 업체 1 · 내 업체 2');
    expect(rows[1]!.note).toBe('6~8월 164건으로 고름 · 다시 계산');
    expect(rows[3]!.note).toBe('이 달엔 기록 없음');
  });

  test('공고마다 하한과 낙찰을 말하고, 판정 칩은 값을 늘 적되 같은 판정은 끝에 둘 다로 한 번만 붙인다', () => {
    const [first, won, blank] = reviewView().rows;
    expect(first!.facts).toEqual(['하한 100.912', '낙찰 업체 가 100.944']);
    expect(first!.opened).toBe('09.16(수) 10:00 개찰');
    expect(first!.details).toEqual([
      { label: '기초금액', value: '8,255,500원', quiet: false },
      { label: '참여', value: '64곳', quiet: false },
      { label: '공고번호', value: 'E260909-658847-0', quiet: true }
    ]);
    expect(first!.verdicts.map((verdict) => `${verdict.name} ${verdict.text}`)).toEqual([
      '낸 값 내 업체 1 99.791 · 내 업체 2 99.900, 둘 다 하한 미달',
      '맞춤 1번 98.490 · 2번 98.940, 둘 다 하한 미달',
      '전국 공식 1번 98.600 · 2번 99.200, 둘 다 하한 미달'
    ]);
    expect(won!.facts).toEqual(['하한 98.450', '우리 낙찰 내 업체 1 98.700', '다른 업체 최저 98.820']);
    expect(won!.verdicts[0]).toEqual({ name: '낸 값', text: '내 업체 1 98.700 낙찰 · 내 업체 2 99.500 1등 자리보다 높음', first: true });
    expect(won!.verdicts[1]).toEqual({ name: '맞춤', text: '1번 98.490 1등 자리 · 2번 98.940 1등 자리보다 높음', first: true });
    expect(won!.won).toBe(true);
    expect(blank!.title).toBe('제목 미확인');
    expect(blank!.winner).toBeNull();
    expect(blank!.band.to).toBe(100);
  });

  test('1등 자리 칸은 낙찰이 아니라 다른 업체 최저에서 끝나, 우리가 낙찰한 공고에서도 1등 자리 칩과 칸이 어긋나지 않는다', () => {
    const won = reviewView().rows[1]!;
    expect(won.band.to).toBeCloseTo(axisPosition('0.988200'), 6);
    expect(won.winner).toBeCloseTo(axisPosition('0.987000'), 6);
    // 맞춤 1번 98.490은 칸 안(1등 자리), 2번 98.940은 칸 밖(1등 자리보다 높음)이다.
    expect(won.lanes['market-pick'].map((mark) => [mark.position < won.band.to, mark.first])).toEqual([[true, true], [false, false]]);
    expect(won.lanes.own[1]!.label).toBe('99.500 · 1등 자리보다 높음');
  });

  test('다시 계산한 값과 예정가격이 없어 뺀 공고를 따로 알린다', () => {
    expect(reviewView().notes).toEqual([
      '이 달 맞춤·전국 공식 값은 그때 화면에 없던 값이에요. 지금 규칙을 그 달 자료에 다시 돌린 것이에요. 화면에 실제로 보였던 값과의 대조는 그 값을 기록하기 시작한 뒤의 공고부터 쌓여요.',
      '예정가격이 아직 안 나온 공고 1건은 대조에서 뺐어요.'
    ]);
  });

  test('기대가 모두 0인 달에는 어느 방법에도 기대 가장 높음을 달지 않는다', () => {
    const zero = {
      ...bidReview,
      selected: { ...bidReview.selected!, summaries: bidReview.selected!.summaries.map((summary) => ({ ...summary, expectedWins: '0.0' })) }
    };
    const view = presentReview(zero);
    if (view.kind !== 'review') throw new Error('복기가 있어야 한다');
    expect(view.summary.map((row) => row.lead)).toEqual([false, false, false, false]);
  });

  test('다시 고른 아침 갱신이 있으면 성적 표·판 표시·읽는 법이 그 사실과 전제(마감 10분 전, 결과가 제때 들어왔다고 봄)를 말한다', () => {
    const selected = bidReview.selected!;
    const habit = {
      ...bidReview,
      selected: {
        ...selected,
        summaries: selected.summaries.map((summary) => (summary.method === 'morning-habit'
          ? { ...summary, rounds: 1, first: 1, allBelowFloor: 0, expectedWins: '0.2', recomputedRounds: 1 } : summary)),
        rounds: selected.rounds.map((round, index) => (index !== 1 ? round : {
          ...round,
          methods: [
            { method: 'morning-habit' as const, source: 'recomputed' as const, version: '2026-10-11', positions: [{ ratio: { value: '0.985200', unit: 'ratio' as const }, verdict: 'first' as const }], expectedWins: '0.2000' },
            ...round.methods
          ]
        }))
      }
    };
    const view = presentReview(habit);
    if (view.kind !== 'review') throw new Error('복기가 있어야 한다');
    expect(view.summary[3]!.note).toBe('마감 10분 전에 켜진 공고 1건만 · 다시 계산');
    expect(view.stamp).toContain('아침 갱신 2026-10-11판');
    expect(view.notes[0]).toStartWith('이 달 맞춤·전국 공식 값은 그때 화면에 없던 값이에요.');
    expect(view.notes[1]).toContain('그날 수집이 늦었던 공고는 이 값이 그때 화면엔 없었을 수 있어요.');
    expect(view.hasHabit).toBe(true);
    expect(view.rows[1]!.verdicts.find((verdict) => verdict.name === '아침 갱신')?.text).toBe('1번 98.520 1등 자리');
  });

  test('기대를 센 예정가격 분포의 판과 공고 수를 판 표시에 밝히고, 아침 갱신 값이 없는 달은 범례에서도 뺀다', () => {
    const view = reviewView();
    expect(view.stamp).toBe('맞춤 2026-10-10판 · 전국 공식 2026-10-10판 · 기대는 예정가격 추첨 평균(2026-10-10판, 공고 108,126건)');
    expect(view.hasHabit).toBe(false);
  });

  test('내 공고가 없으면 빈 상태이고, 화면 문구는 가정·지시 같은 금지 문형을 쓰지 않는다', () => {
    expect(presentReview({ asOf: '2026-10-14T00:00:00Z', months: [], selected: null })).toEqual({ kind: 'empty' });
    expect(findBannedCopy(JSON.stringify(reviewView()))).toEqual([]);
  });
});
