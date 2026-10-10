import { describe, expect, test } from 'bun:test';

import { marketPickRecord } from './market-pick-record';

const evidence = [
  { from: '2026-06', through: '2026-06', rounds: 900, expectedWins: '46.5', ruleExpectedWins: '40.1', currentExpectedWins: '28.0', lotteryExpectedWins: '33.7' },
  { from: '2026-07', through: '2026-09', rounds: 938, expectedWins: '48.5', ruleExpectedWins: '41.8', currentExpectedWins: '29.9', lotteryExpectedWins: '35.0' }
];

describe('맞춤 금액 비교 성적', () => {
  test('네 방법을 값이 큰 순서로 세우고 내 방법 이름은 화면이 정한다', () => {
    const record = marketPickRecord(evidence, { version: '2026-10-10', mineLabel: '10월 맞춤' });
    expect(record.rounds).toBe(1838);
    expect(record.period).toBe('2026년 6월~2026년 9월');
    expect(record.bars.map((bar) => [bar.label, bar.value, bar.widthPercent, bar.mine])).toEqual([
      ['10월 맞춤', '95.0건', '100.0', true],
      ['전국 공식', '81.9건', '86.2', false],
      ['무작위 자리', '68.7건', '72.3', false],
      ['그동안 낸 금액', '57.9건', '60.9', false]
    ]);
    expect(record.title).toBe('같은 공고 1,838건(2026년 6월~2026년 9월)에 대어 본 낙찰 수 · 두 장, 예정가격 추첨 평균');
    expect(record.note).toContain('계산 판 2026-10-10');
  });
});
