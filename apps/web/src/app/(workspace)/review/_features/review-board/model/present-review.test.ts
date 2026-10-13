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
    expect(rows.map((row) => [row.name, row.values, row.firstText, row.expected, row.lead])).toEqual([
      ['실제 낸 값', '공고마다', '1 · 실제 낙찰 1', '0.3', false],
      ['9월 맞춤', '98.490 / 98.940', '1', '0.5', true],
      ['전국 공식', '참여 수별', '0', '0.2', false],
      ['아침 갱신', '공고마다', '0', '0.0', false]
    ]);
    expect(rows[0]!.note).toBe('내 업체 1 · 내 업체 2');
    expect(rows[1]!.note).toBe('6~8월 164건으로 고름 · 다시 계산');
  });

  test('공고마다 하한과 낙찰을 말하고, 1등 자리는 누가 몇에 들었는지, 같은 판정은 둘 다로 묶는다', () => {
    const [first, won, blank] = reviewView().rows;
    expect(first!.facts).toBe('하한 100.912 · 낙찰 업체 가 100.944');
    expect(first!.verdicts.map((verdict) => `${verdict.name} ${verdict.text}`)).toEqual([
      '낸 값 둘 다 하한 미달', '맞춤 둘 다 하한 미달', '전국 공식 둘 다 하한 미달'
    ]);
    expect(won!.facts).toBe('하한 98.450 · 우리 낙찰 내 업체 1 98.700');
    expect(won!.verdicts[0]).toEqual({ name: '낸 값', text: '내 업체 1 98.700 낙찰', first: true });
    expect(won!.verdicts[1]).toEqual({ name: '맞춤', text: '1번 98.490 1등 자리', first: true });
    expect(won!.won).toBe(true);
    expect(blank!.title).toBe('제목 미확인');
    expect(blank!.band).toBeNull();
  });

  test('다시 계산한 값과 예정가격이 없어 뺀 공고를 따로 알린다', () => {
    expect(reviewView().notes).toEqual([
      '이 달 맞춤·전국 공식 값은 그때 화면에 없던 값이에요. 지금 규칙을 그 달 자료에 다시 돌린 것이에요. 화면에 실제로 보인 값과의 대조는 화면 장부를 켠 뒤부터 쌓여요.',
      '예정가격이 아직 안 나온 공고 1건은 대조에서 뺐어요.'
    ]);
  });

  test('내 공고가 없으면 빈 상태이고, 화면 문구는 가정·지시 같은 금지 문형을 쓰지 않는다', () => {
    expect(presentReview({ asOf: '2026-10-14T00:00:00Z', months: [], selected: null })).toEqual({ kind: 'empty' });
    expect(findBannedCopy(JSON.stringify(reviewView()))).toEqual([]);
  });
});
