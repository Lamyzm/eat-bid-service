import { describe, expect, test } from "bun:test";

import { rateMilliText, ratioMillionthsText, summarizeDistribution } from "./distribution-statistics";

// 남산초 실관측 92회차(`docs/product/decision-screen-v2/design-generators/namsan.json`)를 하한율로
// 나눈 칸 목록이다. 형태만 본뜬 예시가 아니라 그 파일에서 세어 낸 실측이며, web fixture·통합 test와
// 같은 숫자가 나와야 서버와 화면이 다른 계산을 하지 않는다는 것이 닫힌다.
const NAMSAN_FLOOR_90 = [
  [90_000n, 20], [90_010n, 8], [90_020n, 8], [90_030n, 8], [90_040n, 4], [90_050n, 3],
  [90_060n, 3], [90_070n, 2], [90_080n, 4], [90_100n, 5], [90_110n, 2], [90_140n, 1],
  [90_150n, 2], [90_160n, 2], [90_190n, 1], [90_210n, 1], [90_270n, 1], [90_430n, 1],
  [90_530n, 1], [90_550n, 1], [90_560n, 1], [90_700n, 1], [90_760n, 1], [91_070n, 1],
] as const;

const NAMSAN_FLOOR_88 = [
  [88_000n, 4], [88_020n, 1], [88_030n, 2], [88_040n, 2], [88_060n, 1],
] as const;

const bins = (rows: ReadonlyArray<readonly [bigint, number]>) =>
  rows.map(([lowerMilli, count]) => ({ lowerMilli, count }));

describe("분포 칸 통계 계산", () => {
  test("남산초 하한율 90 코호트 82건에서 최빈 칸·비중·중앙 칸을 고정한다", () => {
    const summary = summarizeDistribution(bins(NAMSAN_FLOOR_90), 10n);
    expect(summary.sampleCount).toBe(82);
    expect(summary.bins).toHaveLength(24);
    expect(summary.modeRange).toEqual({ fromMilli: 90_000n, toMilli: 90_010n, count: 20, shareMillionths: 243_902n });
    expect(summary.medianBin).toEqual({ fromMilli: 90_030n, toMilli: 90_040n });
  });

  test("남산초 하한율 88 코호트 10건은 겹치지 않는 자리에서 따로 센다", () => {
    const summary = summarizeDistribution(bins(NAMSAN_FLOOR_88), 10n);
    expect(summary.sampleCount).toBe(10);
    expect(summary.bins).toHaveLength(5);
    expect(summary.modeRange).toEqual({ fromMilli: 88_000n, toMilli: 88_010n, count: 4, shareMillionths: 400_000n });
    expect(summary.medianBin).toEqual({ fromMilli: 88_030n, toMilli: 88_040n });
  });

  test("칸 폭을 넓히면 저장 칸을 정확히 합산하고 부동소수를 거치지 않는다", () => {
    const summary = summarizeDistribution(bins(NAMSAN_FLOOR_90), 50n);
    expect(summary.sampleCount).toBe(82);
    expect(summary.bins.slice(0, 3)).toEqual([
      { lowerMilli: 90_000n, count: 48 },
      { lowerMilli: 90_050n, count: 12 },
      { lowerMilli: 90_100n, count: 8 },
    ]);
    // 91.070은 정수 나눗셈으로 [91.050, 91.100)에 들어간다. 부동소수로 나누면 이 경계가 흔들린다.
    expect(summary.bins.at(-1)).toEqual({ lowerMilli: 91_050n, count: 1 });
    expect(summary.modeRange).toEqual({
      fromMilli: 90_000n,
      toMilli: 90_050n,
      count: 48,
      shareMillionths: 585_366n,
    });
  });

  test("표본이 0이면 중앙 칸도 최빈 구간도 지어내지 않는다", () => {
    const summary = summarizeDistribution([], 10n);
    expect(summary).toEqual({ bins: [], sampleCount: 0, medianBin: null, modeRange: null });
  });

  test("최빈이 동률이면 낮은 칸을 고른다", () => {
    const summary = summarizeDistribution(bins([[90_000n, 3], [90_500n, 3]]), 10n);
    expect(summary.modeRange).toEqual({ fromMilli: 90_000n, toMilli: 90_010n, count: 3, shareMillionths: 500_000n });
  });

  test("최빈 구간은 이웃 칸이 절반 이상인 동안 넓히고 빈 칸에서 멈춘다", () => {
    // 90.020이 없는 자리라 오른쪽 확장은 그 칸에서 끊긴다. 빈 칸을 건너뛰면 없는 연속성을 만든다.
    const summary = summarizeDistribution(bins([[89_990n, 5], [90_000n, 8], [90_010n, 4], [90_030n, 8]]), 10n);
    expect(summary.modeRange).toEqual({ fromMilli: 89_990n, toMilli: 90_020n, count: 17, shareMillionths: 680_000n });
  });

  test("칸 목록을 오름차순으로 정규화하고 같은 칸의 행을 합친다", () => {
    // 달을 가로질러 읽은 행은 같은 칸이 여러 번 나온다. 합산은 조회가 아니라 이 계산이 한다.
    const summary = summarizeDistribution(bins([[90_030n, 2], [90_000n, 1], [90_030n, 3]]), 10n);
    expect(summary.bins).toEqual([{ lowerMilli: 90_000n, count: 1 }, { lowerMilli: 90_030n, count: 5 }]);
    expect(summary.sampleCount).toBe(6);
  });

  test("비율은 소수 여섯 자리에서 반올림하고 전량이면 1.000000이다", () => {
    expect(ratioMillionthsText(243_902n)).toBe("0.243902");
    expect(ratioMillionthsText(1_000_000n)).toBe("1.000000");
    expect(ratioMillionthsText(0n)).toBe("0.000000");
    expect(summarizeDistribution(bins([[90_000n, 7]]), 10n).modeRange?.shareMillionths).toBe(1_000_000n);
    // 20/82 = 0.2439024…는 여섯째 자리에서 내림, 1/3 = 0.3333…33은 그대로, 2/3은 올림된다.
    expect(summarizeDistribution(bins([[90_000n, 2], [90_500n, 1]]), 10n).modeRange?.shareMillionths).toBe(666_667n);
  });

  test("사정률 milli를 소수 셋째 자리 canonical 문자열로 되돌린다", () => {
    expect(rateMilliText(90_000n)).toBe("90.000");
    expect(rateMilliText(91_070n)).toBe("91.070");
    expect(rateMilliText(0n)).toBe("0.000");
    expect(rateMilliText(104_000n)).toBe("104.000");
  });
});
