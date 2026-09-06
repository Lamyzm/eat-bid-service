/** @module 책임: 낙찰률 분포 응답을 호가창 사다리 표시 모델로 옮기고 회색 처리 사유를 정한다. */
import type { WinRateDistributionV1Response } from '@eatbid/contracts/api/v1/win-rate-distribution';

import { sampleSizeLabel, type SampleSizeLabel } from './sample-size';

export type LadderRow = {
  readonly fromText: string;
  readonly toText: string;
  readonly count: number;
  /** 막대 폭이다. 창 안 최대 횟수를 1로 둔다. 색이 아니라 길이가 정보를 나른다. */
  readonly barRatio: number;
  readonly inModeRange: boolean;
  readonly isMyRate: boolean;
};

export type MyRatePosition = {
  readonly text: string;
  readonly lowerCount: number;
  readonly higherCount: number;
  /** 같은 값은 추첨이므로 "낮게"에 넣으면 거짓이다. 따로 센다(설계 §6.5). */
  readonly sameCount: number;
};

export type LadderPresentation = {
  readonly rows: readonly LadderRow[];
  readonly belowWindowCount: number;
  readonly aboveWindowCount: number;
  readonly modeText: string | null;
  readonly modeSharePercentText: string | null;
  readonly medianText: string | null;
  readonly myRate: MyRatePosition | null;
};

export type DistributionPresentation = {
  readonly state: 'ready' | 'unknown';
  /** `unknown`일 때만 채워지는 한 문장. 사유를 말하지 않는 회색 자리는 "고장"으로 읽힌다. */
  readonly reason: string | null;
  readonly ladder: LadderPresentation | null;
  readonly sampleCount: number;
  readonly sampleLabel: SampleSizeLabel;
  readonly meta: WinRateDistributionV1Response['meta'];
};

/** 사다리 창은 25줄이다. 중심 ±12이며 그보다 넓으면 한 화면에 담기지 않는다(설계 §6.4). */
const WINDOW_ROWS = 25;
const HALF_WINDOW = (WINDOW_ROWS - 1) / 2;

/** 지역 모집단을 그릴 수 있는 유일한 체계다. eaT 공고지역과 명시적 매핑 없이 같다고 보지 않는다. */
const ADMINISTRATIVE_REGION_SCHEME = 'mois:administrative-region';

// web tsconfig target이 ES2020 미만이라 BigInt 리터럴을 쓸 수 없다. `bid-rate.ts`와 같은 규약이다.
const RATE_SCALE = BigInt(1000);
const MY_RATE_PATTERN = /^[0-9]{1,3}(?:\.[0-9]{1,3})?$/;

export function rateMilli(text: string): bigint {
  const [whole, fraction = ''] = text.split('.');
  return BigInt(whole) * RATE_SCALE + BigInt(`${fraction}000`.slice(0, 3));
}

export function milliText(milli: bigint): string {
  return `${milli / RATE_SCALE}.${(milli % RATE_SCALE).toString().padStart(3, '0')}`;
}

/**
 * 사정률 축 입력이다. 잘못된 입력은 값을 지어내지 않고 없는 것으로 둔다 — URL에 남은 쓰레기가
 * 사다리에 줄을 그으면 사용자가 놓지 않은 값이 그어진 것처럼 보인다.
 */
export function parseMyRate(raw: string | null): bigint | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (!MY_RATE_PATTERN.test(trimmed)) return null;
  return rateMilli(trimmed);
}

function binLowerOf(milli: bigint, widthMilli: bigint): bigint {
  return (milli / widthMilli) * widthMilli;
}

/** 회색 처리 사유. 우선순위 순으로 하나만 말한다. 두 사유를 겹쳐 말하면 사용자가 할 일이 흐려진다. */
function unknownReason(
  response: WinRateDistributionV1Response,
  isRegionScope: boolean
): string | null {
  const { meta } = response;
  if (meta.buildId === null) return '아직 이 조건의 분포를 만든 적이 없습니다';
  if (isRegionScope && meta.regionScheme !== ADMINISTRATIVE_REGION_SCHEME) {
    return `지역 코드 체계가 행안부 기준이 아닙니다(지금 수집 기준: ${meta.regionScheme ?? '미확인'})`;
  }
  // 지역 모집단만 보유율로 잠근다. 전국·이 기관은 지역 축이 없어 이 판정의 분모가 애초에 다르다.
  if (isRegionScope && meta.coverage !== 'complete') return '이 기간·지역은 아직 수집되지 않았습니다';
  if (meta.sampleCount === 0) return '이 조건으로 낙찰된 회차가 아직 없습니다';
  if (sampleSizeLabel(meta.sampleCount) === '표본 부족') return `표본 ${meta.sampleCount}회차`;
  return null;
}

function windowStart(
  centerMilli: bigint,
  widthMilli: bigint,
  myBinMilli: bigint | null
): bigint {
  const half = BigInt(HALF_WINDOW) * widthMilli;
  let start = centerMilli - half;
  if (myBinMilli === null) return start;
  // 내 값이 창 밖이면 창을 민다. 내 값 줄을 그리지 않으면 사용자가 놓은 값이 사라진다.
  const last = start + BigInt(WINDOW_ROWS - 1) * widthMilli;
  if (myBinMilli < start) start = myBinMilli;
  else if (myBinMilli > last) start = myBinMilli - BigInt(WINDOW_ROWS - 1) * widthMilli;
  return start;
}

function myRatePosition(
  counts: ReadonlyMap<bigint, number>,
  myBinMilli: bigint,
  myRateMilli: bigint
): MyRatePosition {
  let lowerCount = 0;
  let higherCount = 0;
  for (const [lower, count] of counts) {
    if (lower < myBinMilli) lowerCount += count;
    else if (lower > myBinMilli) higherCount += count;
  }
  return {
    text: milliText(myRateMilli),
    lowerCount,
    higherCount,
    sameCount: counts.get(myBinMilli) ?? 0
  };
}

function ladderOf(
  response: WinRateDistributionV1Response,
  myRateMilli: bigint | null
): LadderPresentation {
  const widthMilli = rateMilli(response.meta.binWidth.value);
  const counts = new Map(response.bins.map((bin) => [rateMilli(bin.from.value), bin.count] as const));
  const myBinMilli = myRateMilli === null ? null : binLowerOf(myRateMilli, widthMilli);
  // 창의 중심은 최빈 칸이다. 최빈이 없으면(표본 0은 이미 unknown) 가장 낮은 칸을 중심으로 둔다.
  const centerMilli = response.modeRange === null
    ? rateMilli(response.bins[0]?.from.value ?? response.meta.floorRate.value)
    : rateMilli(response.modeRange.from.value);
  const start = windowStart(centerMilli, widthMilli, myBinMilli);
  const end = start + BigInt(WINDOW_ROWS - 1) * widthMilli;
  const modeFrom = response.modeRange === null ? null : rateMilli(response.modeRange.from.value);
  const modeTo = response.modeRange === null ? null : rateMilli(response.modeRange.to.value);

  const windowCounts: number[] = [];
  for (let index = 0; index < WINDOW_ROWS; index += 1) {
    windowCounts.push(counts.get(start + BigInt(index) * widthMilli) ?? 0);
  }
  const maxCount = Math.max(1, ...windowCounts);
  const rows = windowCounts.map((count, index) => {
    const lower = start + BigInt(index) * widthMilli;
    return {
      fromText: milliText(lower),
      toText: milliText(lower + widthMilli),
      count,
      barRatio: count / maxCount,
      inModeRange: modeFrom !== null && modeTo !== null && lower >= modeFrom && lower < modeTo,
      isMyRate: myBinMilli !== null && lower === myBinMilli
    };
  });

  // 창 밖 표본은 숨기지 않고 위·아래 끝에 적는다(AGENTS 7).
  let belowWindowCount = 0;
  let aboveWindowCount = 0;
  for (const [lower, count] of counts) {
    if (lower < start) belowWindowCount += count;
    else if (lower > end) aboveWindowCount += count;
  }

  return {
    rows,
    belowWindowCount,
    aboveWindowCount,
    modeText: response.modeRange === null
      ? null
      : `${response.modeRange.from.value} ~ ${response.modeRange.to.value}`,
    modeSharePercentText: response.modeRange === null
      ? null
      : `${Math.round(Number(response.modeRange.share.value) * 100)}%`,
    medianText: response.medianBin === null
      ? null
      : `${response.medianBin.from.value} ~ ${response.medianBin.to.value}`,
    myRate: myBinMilli === null || myRateMilli === null
      ? null
      : myRatePosition(counts, myBinMilli, myRateMilli)
  };
}

export function presentDistribution(
  response: WinRateDistributionV1Response,
  input: { readonly myRate: string | null; readonly isRegionScope: boolean }
): DistributionPresentation {
  const reason = unknownReason(response, input.isRegionScope);
  const sampleCount = response.meta.sampleCount;
  return {
    state: reason === null ? 'ready' : 'unknown',
    reason,
    ladder: reason === null ? ladderOf(response, parseMyRate(input.myRate)) : null,
    sampleCount,
    sampleLabel: sampleSizeLabel(sampleCount),
    meta: response.meta
  };
}
