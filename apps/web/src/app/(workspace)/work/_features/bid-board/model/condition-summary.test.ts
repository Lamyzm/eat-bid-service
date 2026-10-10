import { describe, expect, test } from 'bun:test';

import { conditionSummary } from './condition-summary';

const area = (codeValueId: string, label: string | null) =>
  ({ codeValueId, code: `C${codeValueId}`, scheme: 'eat:participation-restriction-area', label }) as const;

describe('오늘 투찰 조건 요약', () => {
  test('관심 지역·하한율·내 사업자 수를 한 줄로 말한다', () => {
    expect(conditionSummary({ areas: [area('1', '경남 김해시')], businessCount: 2 }))
      .toBe('관심 지역 경남 김해시 · 하한율 90%·88%·미확인 · 내 사업자 2곳');
  });

  test('지역이 셋 이상이면 앞의 둘과 나머지 수만 쓰고 이름이 없는 코드는 코드로 부른다', () => {
    expect(conditionSummary({ areas: [area('1', '경남 김해시'), area('2', null), area('3', '경남 창원시')], businessCount: 1 }))
      .toBe('관심 지역 경남 김해시, 코드 C2 외 1곳 · 하한율 90%·88%·미확인 · 내 사업자 1곳');
  });

  test('지역을 하나도 고르지 않았으면 그렇게 말하고, 읽지 못한 조각은 지어내지 않고 뺀다', () => {
    // 빈 관심 지역은 "전국"이 아니다. 서버는 참가제한지역이 관측되지 않은 공고만 남긴다(오늘 화면의 "고른 지역 없음"과 같다).
    expect(conditionSummary({ areas: [], businessCount: null })).toBe('고른 지역 없음 · 하한율 90%·88%·미확인');
    expect(conditionSummary({ areas: null, businessCount: 0 })).toBe('하한율 90%·88%·미확인 · 내 사업자 0곳');
  });
});
