import { describe, expect, test } from 'bun:test';
import type { OrganizationAuctionAttempt } from '@eatbid/contracts/api/v1/organizations';

import { namsanRoundsFixture } from '../__fixtures__/namsan-rounds';
import { presentHistory } from './attempt-history';
import type { HistoryRow } from './attempt-history';
import { toMilli, toMilliCeiling } from './bid-rate';
import { judgeRow, rehearse, type RowVerdict } from './rehearsal';

const TEN_THOUSAND = BigInt(10000);

// 손잡이(셋째 자리)와 그날 하한·투찰률 축 낙찰률(넷째 자리)을 반올림 없이 한 축에서 견주는 만분율
// 정수다. judgeRow가 쓰는 ‰ 표현과 독립적이라 구현을 되풀이하지 않고 "무엇이 맞는가"를 따로 말한다.
function toTenThousandth(text: string): bigint {
  const [whole, fraction = ''] = text.split('.');
  return BigInt(whole) * TEN_THOUSAND + BigInt((fraction + '0000').slice(0, 4));
}

/**
 * 계약 응답 한 회차에서 직접 읽은 기대 판정이다. 그날 하한과 낙찰률이 모두 투찰률 축(분모 기초금액)
 * 이므로 손잡이 값과 같은 축에서 비교한다. 낮은 값이 이기는 경쟁이라 손잡이가 낙찰률 이하면 낙찰이고
 * 같은 값은 추첨이라 낙찰로 센다.
 */
function expectedVerdict(attempt: OrganizationAuctionAttempt, rateTenThousandth: bigint): RowVerdict {
  const floor = attempt.dayFloorRate;
  if (floor !== null && rateTenThousandth < toTenThousandth(floor.value)) return 'invalid';
  const awarded = attempt.awardedBidRate;
  if (awarded === null) return 'unknown';
  return rateTenThousandth <= toTenThousandth(awarded.value) ? 'won' : 'missed';
}

function makeRow(overrides: Partial<HistoryRow>): HistoryRow {
  return {
    attemptId: '1',
    revisionId: null,
    announcedAt: '2025-12-29T00:00:00Z',
    openedText: '26-01-01',
    openedYear: '2026',
    openedMonthText: '26-01',
    openedKstDay: 20_454,
    openedMonth: '2026-01',
    itemLabel: '축산',
    floorRateText: '87.745',
    baseAmountText: '2,761,700',
    itemCodeValueId: '7',
    winRateText: null,
    winRateMilli: null,
    awardedBidRateText: null,
    awardedBidRateMilli: null,
    secondRateText: null,
    dayFloorText: null,
    dayFloorMilli: null,
    winnerText: '—',
    listCount: null,
    belowDayFloorCount: null,
    isSelectedItem: true,
    ...overrides
  };
}

describe('judgeRow 축 정합', () => {
  test('낙찰 판정은 사정률 축 낙찰률이 아니라 투찰률 축 낙찰률과 견준다', () => {
    // 두 축이 서로 반대 판정을 내는 회차다. 사정률 낙찰률 90.500과 견줬다면 낙찰이지만 실제로
    // 손잡이와 같은 축인 투찰률 낙찰률은 89.9000이라 놓친 회차다.
    const row = makeRow({
      winRateText: '90.500',
      winRateMilli: toMilli('90.500'),
      awardedBidRateText: '89.9000',
      awardedBidRateMilli: toMilli('89.9000'),
      dayFloorText: '89.0000',
      dayFloorMilli: toMilliCeiling('89.0000')
    });
    expect(judgeRow(row, toMilli('90.200'))).toBe('missed');
  });

  test('사정률 축으로는 놓쳤을 회차라도 투찰률 축에서 낙찰이면 낙찰이다', () => {
    const row = makeRow({
      winRateText: '89.900',
      winRateMilli: toMilli('89.900'),
      awardedBidRateText: '90.5000',
      awardedBidRateMilli: toMilli('90.5000'),
      dayFloorText: '89.0000',
      dayFloorMilli: toMilliCeiling('89.0000')
    });
    expect(judgeRow(row, toMilli('90.200'))).toBe('won');
  });

  test('투찰률 축 낙찰률이 없는 회차는 사정률로 추측하지 않고 판정 불가다', () => {
    const row = makeRow({
      winRateText: '90.500',
      winRateMilli: toMilli('90.500'),
      dayFloorText: '89.0000',
      dayFloorMilli: toMilliCeiling('89.0000')
    });
    expect(judgeRow(row, toMilli('90.200'))).toBe('unknown');
  });

  test('투찰률 축 낙찰률이 없어도 그날 하한을 밑돌면 하한 아래는 확정이다', () => {
    const row = makeRow({
      winRateText: '90.500',
      winRateMilli: toMilli('90.500'),
      dayFloorText: '89.0000',
      dayFloorMilli: toMilliCeiling('89.0000')
    });
    expect(judgeRow(row, toMilli('88.999'))).toBe('invalid');
  });

  test('넷째 자리 낙찰률은 버리지 않고 셋째 자리 손잡이와 정확히 비교한다', () => {
    const row = makeRow({
      awardedBidRateText: '90.1809',
      awardedBidRateMilli: toMilli('90.1809')
    });
    // 90.180 ≤ 90.1809라 낙찰, 90.181 > 90.1809라 놓침. 넷째 자리를 올림했다면 90.181도 낙찰이 된다.
    expect(judgeRow(row, toMilli('90.180'))).toBe('won');
    expect(judgeRow(row, toMilli('90.181'))).toBe('missed');
  });
});

describe('남산초 92회차 실관측 축 대조', () => {
  const attempts = namsanRoundsFixture.attempts;
  const rows = presentHistory(namsanRoundsFixture, null).rows;

  test('fixture는 92회차이고 모든 회차가 두 축의 낙찰률을 함께 싣는다', () => {
    expect(attempts).toHaveLength(92);
    expect(attempts.every((attempt) => attempt.winRate !== null && attempt.awardedBidRate !== null)).toBe(true);
  });

  test('87.000~93.000 손잡이 전 구간에서 judgeRow가 awarded_bid_rate 기준 판정과 100% 일치한다', () => {
    let compared = 0;
    for (let milli = 87_000; milli <= 93_000; milli += 1) {
      const rateText = `${Math.trunc(milli / 1000)}.${String(milli % 1000).padStart(3, '0')}`;
      const rateMilli = toMilli(rateText);
      const rateTenThousandth = BigInt(milli) * BigInt(10);
      rows.forEach((row, index) => {
        const expected = expectedVerdict(attempts[index]!, rateTenThousandth);
        const actual = judgeRow(row, rateMilli);
        if (actual !== expected) {
          throw new Error(`${rateText}에서 회차 ${row.attemptId} 판정이 ${actual}, 기준은 ${expected}`);
        }
        compared += 1;
      });
    }
    // 손잡이 6,001자리 × 92회차를 한 번도 빠뜨리지 않고 대조했다는 것까지 말해야 "100% 일치"가 된다.
    expect(compared).toBe(6001 * 92);
  });

  test('두 축이 벌어진 폭이 남산초에서 실제로 최대 2.1865%p다', () => {
    // 축을 섞어도 되는지는 취향이 아니라 이 표본의 사실이 정한다. 92회차 전부가 0.01%p 이상 벌어진다.
    const gaps = attempts.map((attempt) => {
      const assessment = toTenThousandth(attempt.winRate!.value);
      const bid = toTenThousandth(attempt.awardedBidRate!.value);
      return assessment > bid ? assessment - bid : bid - assessment;
    });
    expect(gaps.filter((gap) => gap >= BigInt(100))).toHaveLength(92);
    expect(gaps.reduce((max, gap) => (gap > max ? gap : max), BigInt(0))).toBe(BigInt(21865));
  });

  test('90.000에서 사정률 축으로 판정하면 92회차 중 42회차가 달라진다', () => {
    // 결함이 실제로 화면을 틀리게 했다는 증거다. 두 축이 같은 답을 준다면 이 이슈는 없다.
    const rateMilli = toMilli('90.000');
    const assessmentVerdict = (row: HistoryRow): RowVerdict => {
      if (row.dayFloorMilli !== null && rateMilli < row.dayFloorMilli) return 'invalid';
      if (row.winRateMilli === null) return 'unknown';
      return rateMilli <= row.winRateMilli ? 'won' : 'missed';
    };
    const differing = rows.filter((row) => judgeRow(row, rateMilli) !== assessmentVerdict(row));
    expect(differing).toHaveLength(42);
    expect(rows.filter((row) => assessmentVerdict(row) === 'won')).toHaveLength(46);
    expect(rows.filter((row) => judgeRow(row, rateMilli) === 'won')).toHaveLength(4);
  });

  test('90.000 이 값이면 요약도 투찰률 축을 따라 92회 중 4회 낙찰값 이하·36회 하한 아래다', () => {
    const rehearsal = rehearse(rows, '90.000');
    expect(rehearsal.total).toBe(92);
    expect(rehearsal.won).toBe(4);
    expect(rehearsal.belowDayFloor).toBe(36);
  });
});
