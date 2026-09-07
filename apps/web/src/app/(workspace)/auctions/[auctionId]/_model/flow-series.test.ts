import { describe, expect, test } from 'bun:test';

import { FLOW_AXIS, decideMyRateLine } from './flow-series';

describe('흐름 차트 내 값 선의 축 결정', () => {
  test('흐름 차트의 눈금은 사정률이고 분모는 예정가격이다', () => {
    expect(FLOW_AXIS.name).toBe('사정률');
    expect(FLOW_AXIS.denominator).toBe('예정가격');
  });

  test('사정률로 놓은 내 값이 있으면 그 값으로 선을 긋는다', () => {
    expect(decideMyRateLine({ myRate: ' 90.030 ', bidRate: '90.309' })).toEqual({ kind: 'drawn', rate: '90.030' });
  });

  test('사정률 내 값이 없으면 레일의 투찰률을 대신 긋지 않고 두 분모가 다르다는 이유를 남긴다', () => {
    const line = decideMyRateLine({ myRate: null, bidRate: '90.309' });
    expect(line.kind).toBe('withheld');
    if (line.kind !== 'withheld') throw new Error('선을 그으면 안 된다');
    // 사용자가 지금 보고 있는 손잡이 값이 왜 차트에 없는지 그 값과 분모 이름으로 말해야 한다(PDR-0004).
    expect(line.reason).toContain('90.309');
    expect(line.reason).toContain('기초금액');
    expect(line.reason).toContain('사정률');
  });

  test('형식이 맞지 않는 내 값은 긋지 않고 형식 이유를 말한다', () => {
    const line = decideMyRateLine({ myRate: '90.0301', bidRate: '90.309' });
    expect(line.kind).toBe('withheld');
    if (line.kind !== 'withheld') throw new Error('선을 그으면 안 된다');
    expect(line.reason).toContain('셋째 자리');
    // 형식 오류 안내에 손잡이 값을 섞으면 그 값을 넣으라는 말로 읽힌다.
    expect(line.reason).not.toContain('90.309');
  });

  test('빈 문자열 내 값은 없는 것과 같이 다룬다', () => {
    const line = decideMyRateLine({ myRate: '   ', bidRate: '90.000' });
    expect(line.kind).toBe('withheld');
    if (line.kind !== 'withheld') throw new Error('선을 그으면 안 된다');
    expect(line.reason).toContain('90.000');
  });
});
