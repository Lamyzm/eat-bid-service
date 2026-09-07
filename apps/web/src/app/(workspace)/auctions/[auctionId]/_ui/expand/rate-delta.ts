/** @module 책임: 같은 사정률 축의 두 값(낙찰률 − 내 값) 차이를 부호 있는 %p 문자열로 만들고, 분모가 다른 값이 이 계산에 들어오지 못하게 한다. */

const SCALE = BigInt(1000);

/**
 * 두 값 모두 사정률(분모 예정가격)의 밀리 단위여야 한다. 레일 손잡이의 투찰률은 분모가 기초금액이라
 * 여기 넣으면 %p가 아닌 값이 나온다(PDR-0004). 0은 `+0.000`이 아니라 `0.000`으로 두어 "같은 값"이
 * 위도 아래도 아님을 그대로 말한다.
 */
export function rateDeltaText(winRateMilli: bigint, myRateMilli: bigint): string {
  const delta = winRateMilli - myRateMilli;
  const sign = delta > BigInt(0) ? '+' : delta < BigInt(0) ? '−' : '';
  const magnitude = delta < BigInt(0) ? -delta : delta;
  const whole = magnitude / SCALE;
  const fraction = (magnitude % SCALE).toString().padStart(3, '0');
  return `${sign}${whole}.${fraction}`;
}
