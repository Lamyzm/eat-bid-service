/**
 * @module 책임: 서버가 준 하한선 분위수(0.005 간격 199개)로 하한 미달 확률, 점 20개 자리, 추첨만 돌린 하한선 뽑기를 계산한다.
 *
 * 분포를 화면에서 새로 만들지 않는다. 맞춤·복기와 같은 판의 분위수를 받아 그 사이를 선형으로 잇기만 한다(PDR-0009).
 */
const STEP = 0.005;

/** 분위수 사이를 선형으로 이어 확률 `p`(0~1)의 하한선 %를 읽는다. 양 끝 밖은 첫·끝 분위수에서 같은 기울기로 늘인다. */
export function floorAtProbability(quantiles: readonly number[], p: number): number {
  const last = quantiles.length - 1;
  const position = p / STEP - 1;
  if (position <= 0) {
    const slope = (quantiles[1]! - quantiles[0]!);
    return quantiles[0]! + slope * position;
  }
  if (position >= last) {
    const slope = (quantiles[last]! - quantiles[last - 1]!);
    return quantiles[last]! + slope * (position - last);
  }
  const index = Math.floor(position);
  const fraction = position - index;
  return quantiles[index]! + fraction * (quantiles[index + 1]! - quantiles[index]!);
}

/** 하한선이 `value`(기초금액 대비 %)보다 위에 떨어질 확률, 곧 이 값으로 넣으면 하한 미달이 될 확률이다. */
export function belowFloorProbability(quantiles: readonly number[], value: number): number {
  if (value < quantiles[0]!) return 1 - STEP * Math.max(0, (value - (quantiles[0]! - (quantiles[1]! - quantiles[0]!))) / (quantiles[1]! - quantiles[0]!));
  const last = quantiles.length - 1;
  if (value >= quantiles[last]!) return Math.max(0, STEP - STEP * (value - quantiles[last]!) / (quantiles[last]! - quantiles[last - 1]!));
  let index = 0;
  while (index < last && quantiles[index + 1]! <= value) index += 1;
  const span = quantiles[index + 1]! - quantiles[index]!;
  const fraction = span === 0 ? 0 : (value - quantiles[index]!) / span;
  const probabilityAtOrBelow = STEP * (index + 1 + fraction);
  return Math.min(1, Math.max(0, 1 - probabilityAtOrBelow));
}

/** 점 20개 자리다. Kay 외(2016)처럼 (i+0.5)/20 분위수를 쓴다. */
export function twentyDots(quantiles: readonly number[]): number[] {
  return Array.from({ length: 20 }, (_, index) => floorAtProbability(quantiles, (index + 0.5) / 20));
}

/** 같은 씨앗이면 같은 수열을 내는 작은 난수다. "다시 굴려 보기"가 씨앗만 바꾸게 한다. */
export function seededRandom(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 추첨만 돌려 하한선 `count`개를 뽑는다. 균등 난수를 분위수로 바꾸는 역변환이다. */
export function drawFloors(quantiles: readonly number[], count: number, random: () => number): number[] {
  return Array.from({ length: count }, () => floorAtProbability(quantiles, Math.min(0.9975, Math.max(0.0025, random()))));
}
