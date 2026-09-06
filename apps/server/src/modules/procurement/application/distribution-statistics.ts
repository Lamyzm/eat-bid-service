/**
 * @module 책임: 저장된 분포 칸을 요청 폭으로 다시 묶고 중앙 칸·최빈 구간을 세는 순수 계산을 소유한다.
 *
 * 값이 소수 셋째 자리 고정이라 모두 BigInt milli(×1000) 정수로 옮겨 계산한다. 부동소수를 한 번이라도
 * 거치면 `floor(x / width) * width`의 칸 경계가 회차마다 흔들려 같은 표본이 다른 칸에 들어간다.
 */

/** 사정률 축 칸 하나. `lowerMilli`는 반개구간 `[lower, lower + width)`의 왼쪽 끝이다. */
export interface DistributionBinCount {
  readonly lowerMilli: bigint;
  readonly count: number;
}

export interface DistributionBinBoundary {
  readonly fromMilli: bigint;
  readonly toMilli: bigint;
}

export interface DistributionModeRange extends DistributionBinBoundary {
  readonly count: number;
  // 비율은 percentage-points가 아니라 ratio 축이라 소수 여섯 자리 정수(백만분율)로 나른다(AGENTS 15).
  readonly shareMillionths: bigint;
}

export interface DistributionSummary {
  readonly bins: readonly DistributionBinCount[];
  readonly sampleCount: number;
  readonly medianBin: DistributionBinBoundary | null;
  readonly modeRange: DistributionModeRange | null;
}

const RATE_SCALE = 1000n;
const RATIO_SCALE = 1_000_000n;

/** milli 정수를 mart numeric(15,3)과 같은 canonical 십진 문자열로 되돌린다. */
export function rateMilliText(milli: bigint): string {
  return `${milli / RATE_SCALE}.${(milli % RATE_SCALE).toString().padStart(3, "0")}`;
}

export function ratioMillionthsText(millionths: bigint): string {
  return `${millionths / RATIO_SCALE}.${(millionths % RATIO_SCALE).toString().padStart(6, "0")}`;
}

// 소수 여섯 자리에서 ROUND_HALF_UP. 내림으로 두면 24.9999%가 24%로 보여 화면이 관측보다 작은 비중을
// 말하고, 정수 나눗셈만 쓰므로 이 반올림도 부동소수를 거치지 않는다.
function shareMillionths(count: number, sampleCount: number): bigint {
  const numerator = BigInt(count) * RATIO_SCALE * 2n + BigInt(sampleCount);
  return numerator / (BigInt(sampleCount) * 2n);
}

/**
 * 요청 폭으로 다시 묶는다. 같은 칸이 여러 달에서 오므로 합산도 여기서 한다. 조회가 합산하면 상위
 * 합과 달별 합이 서로 다른 스냅샷을 읽을 수 있다(설계 §5.2).
 */
function rebucket(
  bins: readonly DistributionBinCount[],
  widthMilli: bigint,
): DistributionBinCount[] {
  const totals = new Map<bigint, number>();
  for (const bin of bins) {
    const lower = (bin.lowerMilli / widthMilli) * widthMilli;
    totals.set(lower, (totals.get(lower) ?? 0) + bin.count);
  }
  const entries: Array<[bigint, number]> = [...totals.entries()].filter(([, count]) => count > 0);
  entries.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return entries.map(([lowerMilli, count]) => ({ lowerMilli, count }));
}

/** 정렬된 표본의 `floor(n / 2)`번째(0-based) 관측이 속한 칸. `rehearsal.ts`의 medianOf와 같은 규칙이다. */
function medianBin(
  bins: readonly DistributionBinCount[],
  widthMilli: bigint,
  sampleCount: number,
): DistributionBinBoundary | null {
  const target = Math.floor(sampleCount / 2);
  let cumulative = 0;
  for (const bin of bins) {
    cumulative += bin.count;
    if (cumulative > target) return { fromMilli: bin.lowerMilli, toMilli: bin.lowerMilli + widthMilli };
  }
  return null;
}

/**
 * 최빈 칸에서 좌우로 이웃 칸의 횟수가 최빈의 절반 이상인 동안 확장한 연속 구간이다
 * (`spec-cohort-v3.md` §4-2). 최빈이 동률이면 낮은 칸을 고른다.
 *
 * 사이가 빈 칸이면 그 칸의 횟수가 0이라 확장이 멈춘다. 빈 칸을 건너뛰면 없는 연속성을 만들게 되므로
 * 이웃 여부는 칸 목록의 인접이 아니라 사다리 위치의 인접으로 본다.
 */
function modeRange(
  bins: readonly DistributionBinCount[],
  widthMilli: bigint,
  sampleCount: number,
): DistributionModeRange | null {
  if (bins.length === 0) return null;
  let peak = 0;
  for (let index = 1; index < bins.length; index += 1) {
    if (bins[index]!.count > bins[peak]!.count) peak = index;
  }
  const peakCount = bins[peak]!.count;
  let low = peak;
  let high = peak;
  while (low > 0
    && bins[low - 1]!.lowerMilli + widthMilli === bins[low]!.lowerMilli
    && bins[low - 1]!.count * 2 >= peakCount) low -= 1;
  while (high + 1 < bins.length
    && bins[high]!.lowerMilli + widthMilli === bins[high + 1]!.lowerMilli
    && bins[high + 1]!.count * 2 >= peakCount) high += 1;
  let count = 0;
  for (let index = low; index <= high; index += 1) count += bins[index]!.count;
  return {
    fromMilli: bins[low]!.lowerMilli,
    toMilli: bins[high]!.lowerMilli + widthMilli,
    count,
    shareMillionths: shareMillionths(count, sampleCount),
  };
}

export function summarizeDistribution(
  rows: readonly DistributionBinCount[],
  widthMilli: bigint,
): DistributionSummary {
  if (widthMilli <= 0n) throw new RangeError("Distribution bin width must be positive");
  const bins = rebucket(rows, widthMilli);
  const sampleCount = bins.reduce((total, bin) => total + bin.count, 0);
  // 표본이 0이면 중앙 칸도 최빈 구간도 없다. 빈 코호트에 값을 지어내지 않는다(AGENTS 3).
  if (sampleCount === 0) return { bins, sampleCount, medianBin: null, modeRange: null };
  return {
    bins,
    sampleCount,
    medianBin: medianBin(bins, widthMilli, sampleCount),
    modeRange: modeRange(bins, widthMilli, sampleCount),
  };
}
