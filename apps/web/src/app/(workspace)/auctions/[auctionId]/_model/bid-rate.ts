/** @module 책임: 투찰률과 기초금액을 문자열 BigInt로 계산해 손잡이·직접 입력·넣을 금액이 부동소수 오차 없이 맞게 한다. */

export type BidRate = string;
export type BidRateStep = '-0.01' | '-0.001' | '+0.001' | '+0.01';

const RATE_SCALE = BigInt(1000);
const MAX_RATE_MILLI = BigInt(100) * RATE_SCALE;

function toMilli(rate: string): bigint {
  const [whole, fraction = ''] = rate.split('.');
  // 직접 입력은 입력한 자릿수 이상을 버린다(반올림하지 않음)
  return BigInt(whole) * RATE_SCALE + BigInt((fraction + '000').slice(0, 3));
}

function fromMilli(milli: bigint): BidRate {
  const whole = milli / RATE_SCALE;
  const fraction = (milli % RATE_SCALE).toString().padStart(3, '0');
  return `${whole}.${fraction}`;
}

/** 손잡이는 0.000~100.000 안에서만 움직인다. 밖으로 나가는 값은 경계에 붙인다. */
export function stepBidRate(rate: BidRate, step: BidRateStep): BidRate {
  const delta = toMilli(step.slice(1)) * (step.startsWith('-') ? BigInt(-1) : BigInt(1));
  const next = toMilli(rate) + delta;
  if (next < BigInt(0)) return fromMilli(BigInt(0));
  if (next > MAX_RATE_MILLI) return fromMilli(MAX_RATE_MILLI);
  return fromMilli(next);
}

export function parseBidRate(input: string): BidRate | null {
  const trimmed = input.trim();
  if (!/^\d{1,3}(\.\d+)?$/.test(trimmed)) return null;
  const milli = toMilli(trimmed);
  if (milli > MAX_RATE_MILLI) return null;
  return fromMilli(milli);
}

/** 기초금액(소수 둘째 자리 wire)에 투찰률(‰ 단위 정수)을 곱해 원 단위로 내린다. 역산한 사정률이 고른 투찰률을 넘지 않게 한다. */
export function bidAmount(baseAmount: string, rate: BidRate): string {
  const [whole, fraction = ''] = baseAmount.split('.');
  const baseCents = BigInt(whole) * BigInt(100) + BigInt((fraction + '00').slice(0, 2));
  // base_cents × rate_milli / (100 cents × 100 percent × 1000 milli)
  return (baseCents * toMilli(rate) / BigInt(10000000)).toString();
}

export function formatWon(amount: string): string {
  return amount.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
