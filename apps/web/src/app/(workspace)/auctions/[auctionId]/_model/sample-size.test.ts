import { describe, expect, test } from 'bun:test';

import { sampleSizeLabel, sampleSizeText } from './sample-size';

describe('표본 라벨', () => {
  test('임계값 10과 30에서 라벨이 바뀐다', () => {
    expect(sampleSizeLabel(0)).toBe('표본 부족');
    expect(sampleSizeLabel(9)).toBe('표본 부족');
    expect(sampleSizeLabel(10)).toBe('표본 적음');
    expect(sampleSizeLabel(29)).toBe('표본 적음');
    expect(sampleSizeLabel(30)).toBeNull();
    expect(sampleSizeLabel(82)).toBeNull();
  });

  test('문장은 표본 수를 늘 말하고 라벨은 필요할 때만 붙인다', () => {
    expect(sampleSizeText(7)).toBe('표본 7회차 · 표본 부족');
    expect(sampleSizeText(12)).toBe('표본 12회차 · 표본 적음');
    expect(sampleSizeText(1150)).toBe('표본 1,150회차');
  });
});
