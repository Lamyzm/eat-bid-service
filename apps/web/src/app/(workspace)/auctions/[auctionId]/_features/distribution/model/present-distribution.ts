/** @module 책임: 분석 낙찰값 분포 응답을 화면이 고르기만 하면 되는 갈래와 구간 줄(비중·건수·막대 길이)로 옮긴다. */
import type { AnalysisDistributionV1Response } from '@eatbid/contracts/api/v1/analysis';

/** 서버 읽기의 갈래와 같은 모양이다. 화면 모델이 server 전용 모듈을 import하지 않도록 여기서 적는다. */
type DistributionRead =
  | { readonly kind: 'distribution'; readonly response: AnalysisDistributionV1Response }
  | { readonly kind: 'cohort-not-found' }
  | { readonly kind: 'read-failed' };

export interface DistributionRowView {
  readonly key: string;
  readonly label: string;
  readonly targetCount: number;
  readonly comparisonCount: number;
  readonly targetShareText: string;
  readonly comparisonShareText: string;
  /** 막대 길이(0~1)다. 두 집단의 가장 큰 비중에 맞춘다 — 집단마다 따로 맞추면 같은 길이가 다른 비중을 말한다. */
  readonly targetWidth: number;
  readonly comparisonWidth: number;
  /** 구간 밖을 모은 줄이다. 칸 폭이 다르므로 막대를 같은 척도로 비교하지 않게 표시를 가른다. */
  readonly outside: boolean;
}

export type DistributionView =
  | { readonly kind: 'cohort-not-found' }
  | { readonly kind: 'read-failed' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'empty'; readonly targetTotal: number; readonly comparisonTotal: number }
  | {
      readonly kind: 'plot';
      readonly rows: readonly DistributionRowView[];
      readonly targetTotal: number;
      readonly comparisonTotal: number;
    };

function share(count: number, total: number): number {
  return total === 0 ? 0 : count / total;
}

function shareText(count: number, total: number): string {
  return total === 0 ? '—' : `${(share(count, total) * 100).toFixed(1)}%`;
}

/** `90.000` → `90.0`. 구간 폭이 0.1%p라 둘째 자리 이하는 늘 0이다. */
function edge(value: string): string {
  return value.slice(0, value.indexOf('.') + 2);
}

/**
 * 줄 순서는 위에서 아래로 높은 사정률이다(시안). 맨 위는 마지막 칸 이상, 맨 아래는 하한 미만이다. 비중의
 * 분모는 그 집단 **전체**다 — 칸 밖을 빼고 나누면 보이는 칸만으로 100%가 되어 밖의 회차가 없는 것처럼 읽힌다.
 */
export function presentDistribution(read: DistributionRead): DistributionView {
  if (read.kind !== 'distribution') return { kind: read.kind };
  const { bins, meta, targetOutside, comparisonOutside } = read.response;
  if (meta.build.buildId === null) return { kind: 'unavailable' };
  if (meta.targetTotal === 0 && meta.comparisonTotal === 0) {
    return { kind: 'empty', targetTotal: 0, comparisonTotal: 0 };
  }
  const first = bins[0];
  const last = bins.at(-1);
  const raw = [
    ...(last === undefined
      ? []
      : [
          {
            key: 'above',
            label: `${edge(last.to.value)}↑`,
            target: targetOutside.above,
            comparison: comparisonOutside.above,
            outside: true
          }
        ]),
    ...bins
      .map((bin) => ({
        key: bin.from.value,
        label: `${edge(bin.from.value)}–${edge(bin.to.value)}`,
        target: bin.targetCount,
        comparison: bin.comparisonCount,
        outside: false
      }))
      .toReversed(),
    ...(first === undefined
      ? []
      : [
          {
            key: 'below',
            label: `하한 미만`,
            target: targetOutside.below,
            comparison: comparisonOutside.below,
            outside: true
          }
        ])
  ];
  const maxShare = Math.max(
    ...raw.map((row) => share(row.target, meta.targetTotal)),
    ...raw.map((row) => share(row.comparison, meta.comparisonTotal)),
    Number.EPSILON
  );
  return {
    kind: 'plot',
    targetTotal: meta.targetTotal,
    comparisonTotal: meta.comparisonTotal,
    rows: raw.map((row) => ({
      key: row.key,
      label: row.label,
      targetCount: row.target,
      comparisonCount: row.comparison,
      targetShareText: shareText(row.target, meta.targetTotal),
      comparisonShareText: shareText(row.comparison, meta.comparisonTotal),
      targetWidth: share(row.target, meta.targetTotal) / maxShare,
      comparisonWidth: share(row.comparison, meta.comparisonTotal) / maxShare,
      outside: row.outside
    }))
  };
}
