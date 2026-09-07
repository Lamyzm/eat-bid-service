import { describe, expect, test } from 'bun:test';

import { attemptsFixture } from '../__fixtures__/attempts';
import { presentHistory } from './attempt-history';
import { rehearse } from './rehearsal';

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

  test('보고 있는 공고 자신은 표에서 빼고 나머지 회차와 표본 수는 응답 그대로 싣는다', () => {
    const current = attemptsFixture.attempts[0]!.attemptId;
    const presentation = presentHistory(attemptsFixture, null, { currentAttemptId: current });
    expect(presentation.rows.map((row) => row.attemptId)).not.toContain(current);
    expect(presentation.rows).toHaveLength(attemptsFixture.attempts.length - 1);
    // 표본 수는 서버가 센 코호트의 사실이다. 화면이 한 행을 뺐다고 고쳐 쓰지 않는다.
    expect(presentation.sampleCount).toBe(attemptsFixture.meta.sampleCount);
  });

  test('응답에 없는 공고 ID를 넘기면 어떤 행도 빠지지 않고 개찰 여부로 다시 거르지도 않는다', () => {
    // 개찰 전 회차를 거르는 것은 계약(opened=only)과 서버 clock의 몫이다. 화면은 응답 행을 그대로 믿는다.
    const withUnopened = {
      ...attemptsFixture,
      attempts: [{ ...attemptsFixture.attempts[0]!, attemptId: '1', openedAt: null }, ...attemptsFixture.attempts]
    };
    const presentation = presentHistory(withUnopened, null, { currentAttemptId: '999999999' });
    expect(presentation.rows).toHaveLength(withUnopened.attempts.length);
    expect(presentation.rows[0]?.attemptId).toBe('1');
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

  test('예정가격 미관측 회차는 그날 하한·하한 미만 수가 null이고 이 값이면 분모에서 빠진다', () => {
    // 추첨 전 회차는 예정가격이 없어 그날 하한을 만들 수 없다. 응답은 0.0000이 아니라 null을 싣고
    // (EAT-74) 화면은 그 없음을 0으로 읽지 않는다.
    const unobserved = {
      ...attemptsFixture.attempts[0]!,
      attemptId: '5796468',
      openedAt: null,
      winRate: null,
      secondRate: null,
      awardedBidRate: null,
      dayFloorRate: null,
      listCount: 3,
      belowDayFloorCount: null,
      winnerSupplierPartyId: null
    };
    const response = { ...attemptsFixture, attempts: [unobserved, ...attemptsFixture.attempts] };
    const presentation = presentHistory(response, null);
    const row = presentation.rows[0]!;
    expect(row.dayFloorText).toBeNull();
    expect(row.dayFloorMilli).toBeNull();
    expect(row.belowDayFloorCount).toBeNull();
    expect(row.awardedBidRateMilli).toBeNull();

    // 판정할 수 없는 회차는 무효로도 낙찰로도 세지 않는다. 남산초 fixture의 분모 15는 그대로다.
    const baseline = rehearse(presentHistory(attemptsFixture, null).rows, '1.000');
    const withUnobserved = rehearse(presentation.rows, '1.000');
    expect(baseline.total).toBe(15);
    expect(withUnobserved.total).toBe(baseline.total);
    expect(withUnobserved.invalid).toBe(baseline.invalid);
    expect(withUnobserved.won).toBe(baseline.won);
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
    expect(presentation.buildId).toBe(attemptsFixture.meta.buildId);
    expect(presentation.sourceReleaseId).toBe(attemptsFixture.meta.sourceReleaseId);
    expect(presentation.calcVersion).toBe(attemptsFixture.meta.calcVersion);
    // 모집단을 어디까지 덮었는지 모르는 표본이라는 사실이 화면까지 그대로 온다(PDR-0003).
    expect(presentation.coverage).toBe('unknown');
    expect(presentation.regionScheme).toBe(attemptsFixture.meta.regionScheme);

    const withoutComputedAt = presentHistory({ ...attemptsFixture, meta: { ...attemptsFixture.meta, computedAt: null } }, null);
    expect(withoutComputedAt.computedAtText).toBeNull();
  });
});
