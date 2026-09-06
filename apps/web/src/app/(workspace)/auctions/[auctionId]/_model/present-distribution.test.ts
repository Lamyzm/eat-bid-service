import { describe, expect, test } from 'bun:test';

import {
  emptyDistributionFixture,
  floor88DistributionFixture,
  floor90DistributionFixture
} from '../__fixtures__/distribution';
import { parseMyRate, presentDistribution } from './present-distribution';

const national = { myRate: null, isRegionScope: false } as const;

const rowOf = (presentation: ReturnType<typeof presentDistribution>, from: string) =>
  presentation.ladder?.rows.find((row) => row.fromText === from);

describe('호가창 사다리 표시 모델', () => {
  test('남산초 하한율 90 코호트의 최빈 칸·중앙 칸·비중을 사다리로 옮긴다', () => {
    const presentation = presentDistribution(floor90DistributionFixture, national);
    expect(presentation.state).toBe('ready');
    expect(presentation.sampleCount).toBe(82);
    expect(presentation.sampleLabel).toBeNull();
    expect(presentation.ladder?.modeText).toBe('90.000 ~ 90.010');
    expect(presentation.ladder?.modeSharePercentText).toBe('24%');
    expect(presentation.ladder?.medianText).toBe('90.030 ~ 90.040');
    expect(rowOf(presentation, '90.000')).toMatchObject({ count: 20, inModeRange: true, barRatio: 1 });
    expect(rowOf(presentation, '90.030')).toMatchObject({ count: 8, inModeRange: false });
  });

  test('하한율 88 코호트는 겹치지 않는 자리에서 따로 센다', () => {
    const presentation = presentDistribution(floor88DistributionFixture, national);
    expect(presentation.state).toBe('ready');
    expect(presentation.sampleCount).toBe(10);
    expect(presentation.sampleLabel).toBe('표본 적음');
    expect(presentation.ladder?.modeText).toBe('88.000 ~ 88.010');
    expect(presentation.ladder?.medianText).toBe('88.030 ~ 88.040');
    expect(rowOf(presentation, '88.030')).toMatchObject({ count: 2 });
    // 90 코호트의 칸은 이 사다리에 없다.
    expect(rowOf(presentation, '90.000')).toBeUndefined();
  });

  test('창은 25줄이고 최빈 칸을 중심으로 잡히며 빈 칸은 0으로 채운다', () => {
    const presentation = presentDistribution(floor90DistributionFixture, national);
    expect(presentation.ladder?.rows).toHaveLength(25);
    expect(presentation.ladder?.rows[0]?.fromText).toBe('89.880');
    expect(presentation.ladder?.rows.at(-1)?.fromText).toBe('90.120');
    // 89.880은 관측이 없는 칸이다. 사다리는 그 자리를 0으로 채운다.
    expect(rowOf(presentation, '89.880')).toMatchObject({ count: 0, barRatio: 0 });
    expect(rowOf(presentation, '90.090')).toMatchObject({ count: 0 });
  });

  test('창 밖 표본을 위·아래로 나눠 보고하고 합이 표본 수와 같다', () => {
    const presentation = presentDistribution(floor90DistributionFixture, national);
    const inWindow = (presentation.ladder?.rows ?? []).reduce((total, row) => total + row.count, 0);
    const below = presentation.ladder?.belowWindowCount ?? 0;
    const above = presentation.ladder?.aboveWindowCount ?? 0;
    expect(below).toBe(0);
    expect(above).toBeGreaterThan(0);
    expect(inWindow + below + above).toBe(82);
  });

  test('내 값이 창 밖이면 창이 밀려 그 줄이 사다리에 들어온다', () => {
    const presentation = presentDistribution(floor90DistributionFixture, {
      myRate: '91.070',
      isRegionScope: false
    });
    expect(rowOf(presentation, '91.070')).toMatchObject({ isMyRate: true, count: 1 });
    expect(presentation.ladder?.rows).toHaveLength(25);
    expect(presentation.ladder?.rows.at(-1)?.fromText).toBe('91.070');
  });

  test('내 값 칸은 낮게에도 높게에도 넣지 않고 같은 칸으로 센다', () => {
    const presentation = presentDistribution(floor90DistributionFixture, {
      myRate: '90.0305',
      isRegionScope: false
    });
    const myRate = presentation.ladder?.myRate;
    // 넷째 자리는 사정률 관측 정밀도 밖이라 계약이 받지 않는다. 값을 지어내지 않고 없는 것으로 둔다.
    expect(myRate).toBeNull();

    const exact = presentDistribution(floor90DistributionFixture, { myRate: '90.03', isRegionScope: false });
    expect(exact.ladder?.myRate).toEqual({
      text: '90.030',
      lowerCount: 36,
      higherCount: 38,
      sameCount: 8
    });
    expect((exact.ladder?.myRate?.lowerCount ?? 0) + (exact.ladder?.myRate?.higherCount ?? 0)
      + (exact.ladder?.myRate?.sameCount ?? 0)).toBe(82);
  });

  test('잘못된 내 값 입력은 사다리를 오염시키지 않는다', () => {
    for (const invalid of ['', '  ', 'abc', '-90', '90.0301', '1234', '90,03']) {
      expect(parseMyRate(invalid), invalid).toBeNull();
    }
    expect(parseMyRate('90')).toBe(BigInt(90000));
    expect(parseMyRate(' 90.03 ')).toBe(BigInt(90030));
    expect(presentDistribution(floor90DistributionFixture, { myRate: 'abc', isRegionScope: false })
      .ladder?.myRate).toBeNull();
  });

  test('활성 build가 없으면 사다리를 그리지 않고 그 사유를 말한다', () => {
    const presentation = presentDistribution(emptyDistributionFixture, national);
    expect(presentation.state).toBe('unknown');
    expect(presentation.reason).toBe('아직 이 조건의 분포를 만든 적이 없습니다');
    expect(presentation.ladder).toBeNull();
    // 계보 meta는 unknown일 때도 그대로 남는다. 각주가 왜 비었는지 말할 수 있어야 한다(AGENTS 7).
    expect(presentation.meta.period).toEqual({ from: '2026-08', to: '2026-09' });
  });

  test('표본이 없거나 10회차 미만이면 회색으로 두고 표본 수를 말한다', () => {
    const noSample = {
      ...floor90DistributionFixture,
      bins: [],
      medianBin: null,
      modeRange: null,
      meta: { ...floor90DistributionFixture.meta, sampleCount: 0 }
    };
    expect(presentDistribution(noSample, national)).toMatchObject({
      state: 'unknown',
      reason: '이 조건으로 낙찰된 회차가 아직 없습니다'
    });

    const scarce = {
      ...floor90DistributionFixture,
      meta: { ...floor90DistributionFixture.meta, sampleCount: 7 }
    };
    expect(presentDistribution(scarce, national)).toMatchObject({
      state: 'unknown',
      reason: '표본 7회차',
      sampleLabel: '표본 부족'
    });
  });

  test('지역 모집단은 코드 체계가 행안부가 아니면 잠기고 전국은 영향받지 않는다', () => {
    expect(presentDistribution(floor90DistributionFixture, { myRate: null, isRegionScope: true }))
      .toMatchObject({
        state: 'unknown',
        reason: '지역 코드 체계가 행안부 기준이 아닙니다(지금 수집 기준: eat:auction-location-sigungu)'
      });
    // 같은 응답이 전국 모집단에서는 그대로 그려진다(설계 §5.3·§6.3).
    expect(presentDistribution(floor90DistributionFixture, national).state).toBe('ready');
  });

  test('행안부 체계여도 보유율이 complete가 아니면 지역 모집단은 잠긴다', () => {
    const mois = {
      ...floor90DistributionFixture,
      meta: { ...floor90DistributionFixture.meta, regionScheme: 'mois:administrative-region' }
    };
    expect(presentDistribution(mois, { myRate: null, isRegionScope: true })).toMatchObject({
      state: 'unknown',
      reason: '이 기간·지역은 아직 수집되지 않았습니다'
    });
    const complete = { ...mois, meta: { ...mois.meta, coverage: 'complete' as const } };
    expect(presentDistribution(complete, { myRate: null, isRegionScope: true }).state).toBe('ready');
  });
});
