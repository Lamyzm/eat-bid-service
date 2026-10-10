import { describe, expect, test } from 'bun:test';

import { conditionSummary } from './condition-summary';

const area = (codeValueId: string, label: string | null) =>
  ({ codeValueId, code: `C${codeValueId}`, scheme: 'eat:participation-restriction-area', label }) as const;

describe('오늘 투찰 조건 요약', () => {
  test('관심 지역·하한율·내 사업자 수를 한 줄로 말한다', () => {
    expect(conditionSummary({ areas: [area('1', '경남 김해시')], businessCount: 2 }))
      .toBe('관심 지역 경남 김해시 · 하한율 90%·88% · 내 사업자 2곳');
  });

  test('지역이 셋 이상이면 앞의 둘과 나머지 수만 쓰고 이름이 없는 코드는 코드로 부른다', () => {
    expect(conditionSummary({ areas: [area('1', '경남 김해시'), area('2', null), area('3', '경남 창원시')], businessCount: 1 }))
      .toBe('관심 지역 경남 김해시, 코드 C2 외 1곳 · 하한율 90%·88% · 내 사업자 1곳');
  });

  test('지역으로 좁히지 않기로 확인했으면 모든 지역이고, 읽지 못한 조각은 지어내지 않고 뺀다', () => {
    expect(conditionSummary({ areas: [], businessCount: null })).toBe('모든 지역 · 하한율 90%·88%');
    expect(conditionSummary({ areas: null, businessCount: 0 })).toBe('하한율 90%·88% · 내 사업자 0곳');
  });
});
