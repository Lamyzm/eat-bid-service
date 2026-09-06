import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { floor88DistributionFixture, floor90DistributionFixture } from './distribution';

/**
 * 이 fixture의 숫자가 실측인지 조사 파일로 직접 확인한다. "형태만 본뜬 예시"와 "실관측"을 주석으로만
 * 구분하면 언젠가 한쪽이 조용히 다른 쪽이 된다.
 */
const repositoryRoot = resolve(import.meta.dir, '../../../../../../../..');
const namsanPath = resolve(repositoryRoot, 'docs/product/decision-screen-v2/design-generators/namsan.json');

type NamsanRound = { readonly floorRate: number; readonly winRate: number };

function observedBins(floorRate: number): Map<string, number> {
  const rounds = JSON.parse(readFileSync(namsanPath, 'utf8')) as readonly NamsanRound[];
  const bins = new Map<string, number>();
  for (const round of rounds) {
    if (round.floorRate !== floorRate) continue;
    // 반개구간 `[lower, lower + 0.01)`. 소스 값이 소수 셋째 자리라 milli 정수로 옮겨 나눈다.
    const milli = Math.round(round.winRate * 1000);
    const lower = Math.floor(milli / 10) * 10;
    const text = `${Math.floor(lower / 1000)}.${(lower % 1000).toString().padStart(3, '0')}`;
    bins.set(text, (bins.get(text) ?? 0) + 1);
  }
  return bins;
}

describe('남산초 분포 fixture', () => {
  test('하한율 90 코호트 82회차 24칸이 조사 파일의 집계와 같다', () => {
    const observed = observedBins(90);
    expect(observed.size).toBe(24);
    expect([...observed.values()].reduce((total, count) => total + count, 0)).toBe(82);
    expect(floor90DistributionFixture.bins.map((bin) => [bin.from.value, bin.count]))
      .toEqual([...observed.entries()].toSorted(([left], [right]) => left.localeCompare(right)));
    expect(floor90DistributionFixture.meta.sampleCount).toBe(82);
  });

  test('하한율 88 코호트 10회차 5칸이 조사 파일의 집계와 같다', () => {
    const observed = observedBins(88);
    expect(observed.size).toBe(5);
    expect([...observed.values()].reduce((total, count) => total + count, 0)).toBe(10);
    expect(floor88DistributionFixture.bins.map((bin) => [bin.from.value, bin.count]))
      .toEqual([...observed.entries()].toSorted(([left], [right]) => left.localeCompare(right)));
    expect(floor88DistributionFixture.meta.sampleCount).toBe(10);
  });

  test('두 코호트는 서로 겹치지 않는 자리에 산다', () => {
    // 하한율을 코호트 키로 쓰지 않으면 이 둘이 한 히스토그램에 섞여 "두 봉우리"라는 없는 사실이 생긴다.
    const ninety = new Set(floor90DistributionFixture.bins.map((bin) => bin.from.value));
    for (const bin of floor88DistributionFixture.bins) expect(ninety.has(bin.from.value)).toBe(false);
  });

  test('fixture가 선언한 최빈 칸·중앙 칸이 그 칸 목록에서 다시 계산된다', () => {
    for (const fixture of [floor90DistributionFixture, floor88DistributionFixture]) {
      const bins = fixture.bins;
      const maxCount = Math.max(...bins.map((bin) => bin.count));
      const modal = bins.find((bin) => bin.count === maxCount);
      expect(fixture.modeRange?.from.value).toBe(modal?.from.value ?? '');
      expect(fixture.modeRange?.count).toBe(maxCount);

      const target = Math.floor(fixture.meta.sampleCount / 2);
      let cumulative = 0;
      const median = bins.find((bin) => {
        cumulative += bin.count;
        return cumulative > target;
      });
      expect(fixture.medianBin?.from.value).toBe(median?.from.value ?? '');
    }
  });
});
