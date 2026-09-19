/**
 * @module 책임: 시간축 그림의 사정률 축 범위와 눈금, 축 밖 관측 수를 정한다.
 *
 * 표시 모델 조립에서 떼어 낸 이유는 함께 바뀌는 이유가 다르기 때문이다. 이쪽은 "어디까지 보여 줄
 * 것인가"의 규칙이고, 저쪽은 "무엇을 그릴 것인가"의 조립이다.
 */

/** 축 밖으로 나간 관측 수다. 위아래를 나누는 이유는 사용자가 어느 쪽을 더 봐야 할지가 다르기 때문이다. */
export interface OutsideCount {
  readonly above: number;
  readonly below: number;
}

export interface TimeSeriesDomainRates {
  readonly yFrom: number;
  readonly yTo: number;
}

/** 사정률 하나와 그것이 대표하는 관측 수다. 밀도 칸은 한 자리가 여러 관측을 대표한다. */
export interface RateWeight {
  readonly rate: number;
  readonly count: number;
}

/** 관측 수로 가중한 분위수다. 밀도 칸 하나를 관측 하나로 세면 넓은 칸이 좁은 칸과 같은 무게를 갖는다. */
export function weightedQuantile(sorted: readonly RateWeight[], total: number, q: number): number {
  let seen = 0;
  const target = total * q;
  for (const entry of sorted) {
    seen += entry.count;
    if (seen >= target) return entry.rate;
  }
  return sorted[sorted.length - 1]?.rate ?? 0;
}

/**
 * 사정률 축의 범위다. **최솟값·최댓값으로 잡지 않는다.**
 *
 * 극단값 하나까지 담으려고 축을 늘리면 나머지 관측이 전부 바닥에 뭉친다 — 2026-09-18 dev에서 점 다섯
 * 중 하나가 1.4%p 떨어져 있었고 나머지 넷이 한 줄로 붙어 읽히지 않았다. 축은 가운데 덩어리에 맞추고
 * 밖으로 나간 것은 **세어서 글로 말한다**(시안이 쓰는 `위쪽 범위 밖: 기관 1건 · 지역 전체 395건`).
 * 이것은 극단값을 숨기는 것이 아니다 — 숨기는 것은 세지 않고 안 그리는 쪽이고, 여기서는 수가 남고
 * `전체 값 보기`로 즉시 되돌릴 수 있다.
 *
 * 관측이 한 점뿐이면 폭이 0이라 나눌 수 없으므로 최소 폭을 준다. 그 최소 폭은 사정률 칸 하나(0.1%p)의
 * 열 배이며, 한 점짜리 그림에서 눈금이 한 칸도 서지 않는 것을 막는 자리다.
 */
export function rateDomain(weights: readonly RateWeight[]): TimeSeriesDomainRates {
  const sorted = weights.toSorted((a, b) => a.rate - b.rate);
  const total = sorted.reduce((sum, entry) => sum + entry.count, 0);
  // 아래위 2%를 덜어 낸다. 더 깎으면 실제 분포의 꼬리가 잘리고, 덜 깎으면 극단값 하나가 축을 끈다.
  const low = weightedQuantile(sorted, total, 0.02);
  const high = weightedQuantile(sorted, total, 0.98);
  const span = Math.max(high - low, 1_000);
  const pad = Math.round(span * 0.08);
  // 덩어리를 가운데 두고 최소 폭을 지킨다. 양끝에만 여백을 더하면 한 점짜리 그림이 0.16%p까지
  // 좁혀져, 눈금 다섯 개가 실제로는 아무 차이도 아닌 간격을 큰 차이처럼 보이게 만든다.
  const center = (low + high) / 2;
  const half = Math.round(span / 2) + pad;
  return { yFrom: center - half, yTo: center + half };
}

/** 축 밖으로 나간 관측 수다. 위아래를 나누는 이유는 사용자가 어느 쪽을 더 봐야 할지가 다르기 때문이다. */
export function countOutside(weights: readonly RateWeight[], domain: TimeSeriesDomainRates): OutsideCount {
  let above = 0;
  let below = 0;
  for (const entry of weights) {
    if (entry.rate > domain.yTo) above += entry.count;
    else if (entry.rate < domain.yFrom) below += entry.count;
  }
  return { above, below };
}

/** 눈금은 다섯 자리를 넘지 않게 고른다. 더 촘촘하면 라벨이 겹치고 더 성기면 값을 읽을 수 없다. */
export function ticks<Value>(from: number, to: number, count: number, make: (value: number) => Value): Value[] {
  if (!(to > from)) return [make(from)];
  const step = (to - from) / (count - 1);
  return Array.from({ length: count }, (_, index) => make(from + step * index));
}
