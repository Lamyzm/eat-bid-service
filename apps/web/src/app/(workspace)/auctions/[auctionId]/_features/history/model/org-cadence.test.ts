import { describe, expect, test } from 'bun:test';

import { attemptsFixture } from '../../../__fixtures__/attempts';
import { openAuctionFixture } from '../../../__fixtures__/auction';
import { presentHistory } from './attempt-history';
import { presentOrgCadence } from './org-cadence';

const ready = (response = attemptsFixture) => ({ state: 'ready', presentation: presentHistory(response, null) }) as const;
const current = { announcedAt: openAuctionFixture.schedule.announcedAt };

describe('기관 회차 주기 표시 모델', () => {
  test('누적 회차는 응답 meta의 표본 수이고 발주 주기는 공고 간격 중앙값을 간격 표본 수와 함께 말한다', () => {
    const cadence = presentOrgCadence(ready(), current);
    expect(cadence.attemptCountText).toBe(`${attemptsFixture.meta.sampleCount}회`);
    // fixture 20회의 공고 간격 19개 중 중앙값(percentile_disc 0.5 규약, 짝수면 아래쪽)이다.
    const announced = attemptsFixture.attempts.map((attempt) => attempt.announcedAt).toSorted();
    const gaps = announced.slice(1).map((later, index) => Math.round((Date.parse(later) - Date.parse(announced[index]!)) / 86_400_000)).filter((days) => days > 0).toSorted((a, b) => a - b);
    const median = gaps[Math.floor((gaps.length - 1) / 2)];
    expect(cadence.cadenceText).toBe(`보통 ${median}일마다 공고`);
    expect(cadence.cadenceBasisText).toBe(`간격 ${gaps.length}회 기준`);
  });

  test('지난 공고는 보고 있는 공고보다 앞선 가장 늦은 회차의 공고일과 며칠 만인지다', () => {
    const cadence = presentOrgCadence(ready(), current);
    // 최신 회차 2026-08-07T00:00Z(KST 09:00) → 현재 공고 2026-09-01T00:00Z까지 25일이다.
    expect(cadence.lastAnnouncementText).toBe('지난 공고 08-07 · 25일 만');
  });

  test('같은 날 나눠 낸 공고(간격 0일)는 발주 주기 표본에서 빠지고 회차 하나면 주기·지난 공고가 없다', () => {
    const first = attemptsFixture.attempts[0]!;
    const sameDay = { ...attemptsFixture, attempts: [first, { ...first, attemptId: '1' }], meta: { ...attemptsFixture.meta, sampleCount: 2 } };
    const cadence = presentOrgCadence(ready(sameDay), current);
    expect(cadence.attemptCountText).toBe('2회');
    expect(cadence.cadenceText).toBeNull();
    expect(cadence.cadenceBasisText).toBeNull();
    expect(cadence.lastAnnouncementText).toBe('지난 공고 08-07 · 25일 만');

    const only = { ...sameDay, attempts: [{ ...first, announcedAt: '2026-09-05T00:00:00Z' }], meta: { ...attemptsFixture.meta, sampleCount: 1 } };
    const single = presentOrgCadence(ready(only), current);
    expect(single.cadenceText).toBeNull();
    // 현재 공고보다 뒤에 난 회차는 "지난 공고"가 아니다.
    expect(single.lastAnnouncementText).toBeNull();
  });

  test('회차 이력을 못 받았거나 기관이 없으면 회차 미확인이고 어떤 값도 지어내지 않는다', () => {
    for (const history of [{ state: 'unavailable' }, { state: 'no-organization' }] as const) {
      const cadence = presentOrgCadence(history, current);
      expect(cadence).toEqual({ attemptCountText: '회차 미확인', cadenceText: null, cadenceBasisText: null, lastAnnouncementText: null });
    }
  });
});
