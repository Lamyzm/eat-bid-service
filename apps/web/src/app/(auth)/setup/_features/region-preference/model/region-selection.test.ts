import { describe, expect, test } from 'bun:test';

import type { EligibilityAreaGroup } from '@/api/eligibility-areas';

import {
  areaText,
  groupSelectedCount,
  removeArea,
  sameSelection,
  selectedAreas,
  selectionToCodeValueIds,
  toggleArea
} from './region-selection';

const gyeongnam: EligibilityAreaGroup = {
  all: { codeValueId: '9101', code: '15000', scheme: 'eat:eligibility-area', label: '경남/전체' },
  parts: [
    { codeValueId: '9102', code: '15653', scheme: 'eat:eligibility-area', label: '경남/김해시' },
    { codeValueId: '9103', code: '15714', scheme: 'eat:eligibility-area', label: '경남/창원시' }
  ]
};

const unlabeled: EligibilityAreaGroup = {
  all: { codeValueId: '9201', code: '05000', scheme: 'eat:eligibility-area', label: null },
  parts: []
};

const groups = [gyeongnam, unlabeled];

describe('지역 선택 규칙', () => {
  test('시군구를 고르면 그 도의 전체가 함께 켜진다', () => {
    const selection = toggleArea(new Set(), gyeongnam, '9102');
    expect([...selection].toSorted()).toEqual(['9101', '9102']);
    // 함께 켜진 전체도 고른 목록에 그대로 보인다. 조용히 켜고 감추지 않는다.
    expect(selectedAreas(groups, selection).map(areaText)).toEqual(['경남/전체', '경남/김해시']);
  });

  test('함께 켜진 도 전체만 따로 뺄 수 있고 시군구는 남는다', () => {
    const withBoth = toggleArea(new Set(), gyeongnam, '9102');
    const trimmed = removeArea(withBoth, '9101');
    expect([...trimmed]).toEqual(['9102']);
    // 뺀 상태가 그대로 저장에 나간다. "자동으로 켰다"는 상태를 따로 남기지 않는다.
    expect(selectionToCodeValueIds(groups, trimmed)).toEqual(['9102']);
  });

  test('도 전체를 칸에서 끄는 것도 시군구를 함께 끄지 않는다', () => {
    const withBoth = toggleArea(new Set(), gyeongnam, '9102');
    const offAll = toggleArea(withBoth, gyeongnam, '9101');
    expect([...offAll]).toEqual(['9102']);
  });

  test('시군구를 끄면 그 코드만 빠지고 도 전체는 남는다', () => {
    const withBoth = toggleArea(new Set(), gyeongnam, '9102');
    const offPart = toggleArea(withBoth, gyeongnam, '9102');
    expect([...offPart]).toEqual(['9101']);
  });

  test('도 전체를 먼저 고르면 시군구가 따라 켜지지 않는다', () => {
    const selection = toggleArea(new Set(), gyeongnam, '9101');
    expect([...selection]).toEqual(['9101']);
  });

  test('묶음별 선택 수를 세고 라벨 없는 코드는 코드 문자열로 부른다', () => {
    const selection = toggleArea(new Set(), gyeongnam, '9102');
    expect(groupSelectedCount(gyeongnam, selection)).toBe(2);
    expect(groupSelectedCount(unlabeled, selection)).toBe(0);
    expect(areaText(unlabeled.all)).toBe('코드 05000');
  });

  test('저장된 목록과 같은 선택은 순서가 달라도 같다고 본다', () => {
    expect(sameSelection(['9101', '9102'], ['9102', '9101'])).toBe(true);
    expect(sameSelection(['9101'], ['9101', '9102'])).toBe(false);
    expect(sameSelection([], [])).toBe(true);
  });
});
