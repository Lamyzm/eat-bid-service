import { describe, expect, test } from 'bun:test';

import { attemptsFixture } from '../__fixtures__/attempts';
import { presentHistory } from './attempt-history';

describe('기관 회차 이력 표시 모델', () => {
  test('개찰 시각이 있으면 KST YY-MM-DD로 표시하고 openedYear는 4자리다', () => {
    const presentation = presentHistory(attemptsFixture, null);
    // 첫 회차는 openedAt '2026-08-10T04:00:00Z' → KST 13시, 날짜는 그대로 08-10이다.
    expect(presentation.rows[0]?.openedText).toBe('26-08-10');
    expect(presentation.rows[0]?.openedYear).toBe('2026');
  });

  test('개찰 전(openedAt null) 회차는 공고일 뒤에 공고를 붙이고 openedYear는 공고 연도다', () => {
    const response = {
      ...attemptsFixture,
      attempts: [{ ...attemptsFixture.attempts[0]!, openedAt: null, announcedAt: '2026-01-05T00:00:00Z' }]
    };
    const presentation = presentHistory(response, null);
    expect(presentation.rows[0]?.openedText).toBe('26-01-05 공고');
    expect(presentation.rows[0]?.openedYear).toBe('2026');
  });

  test('품목이 없는 회차는 미확인으로 표시하고 코드값은 null이다', () => {
    const response = {
      ...attemptsFixture,
      attempts: [{ ...attemptsFixture.attempts[0]!, item: null }]
    };
    const presentation = presentHistory(response, null);
    expect(presentation.rows[0]?.itemLabel).toBe('미확인');
    expect(presentation.rows[0]?.itemCodeValueId).toBeNull();
  });

  test('선택 품목이 없으면 모든 행이 isSelectedItem true다', () => {
    const presentation = presentHistory(attemptsFixture, null);
    expect(presentation.rows.every((row) => row.isSelectedItem)).toBe(true);
    expect(presentation.selectedItem).toBeNull();
  });

  test('선택 품목이 있으면 일치하는 행만 표시하고 selectedItem에 라벨을 담는다', () => {
    const presentation = presentHistory(attemptsFixture, '8');
    const flags = presentation.rows.map((row) => row.isSelectedItem);
    expect(flags.some(Boolean)).toBe(true);
    expect(flags.filter(Boolean)).toHaveLength(3);
    expect(presentation.selectedItem).toEqual({ codeValueId: '8', label: '공산' });
  });

  test('낙찰자가 없으면 —, 있으면 #id로 표시한다', () => {
    const presentation = presentHistory(attemptsFixture, null);
    const withWinner = presentation.rows.find((row) => row.attemptId === '5669410');
    const withoutWinner = presentation.rows.find((row) => row.attemptId === '5667147');
    expect(withWinner?.winnerText).toBe('#9100000');
    expect(withoutWinner?.winnerText).toBe('—');
  });

  test('meta의 산출 시각을 KST MM-DD HH:mm로 표시하고 없으면 null이다', () => {
    const presentation = presentHistory(attemptsFixture, null);
    expect(presentation.computedAtText).toBe('09-04 09:10');
    expect(presentation.sampleCount).toBe(attemptsFixture.meta.sampleCount);
    expect(presentation.martRelease).toBe(attemptsFixture.meta.martRelease);
    expect(presentation.calcVersion).toBe(attemptsFixture.meta.calcVersion);

    const withoutComputedAt = presentHistory({ ...attemptsFixture, meta: { ...attemptsFixture.meta, computedAt: null } }, null);
    expect(withoutComputedAt.computedAtText).toBeNull();
  });
});
