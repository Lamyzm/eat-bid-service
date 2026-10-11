/**
 * @module 책임: 추천 금액 한 자리를 eaT에 넣는 소수(사정률·기초금액 대비 %)와 확인용 금액으로 바꾼다. 오늘 투찰과 공고 상세가 같은
 * 숫자를 같은 이름으로 보이게 화면 밖에 둔다.
 *
 * 투찰 소수는 분모가 셋이다(기초금액, 예정가격, 기초금액×하한율). 이름 없이 숫자만 두면 옮겨 적다 10% 가까이 틀린다(ADR 0062).
 * 그래서 숫자마다 분모를 이름으로 붙인다. 계산은 문자열 정수로 하고 Number로 바꾸지 않는다(AGENTS 15).
 */

export type BidFigure = {
  /** 사정률(기초금액×하한율에 곱하는 배수의 %). 소수 셋째 자리. 나누어떨어지지 않거나 하한율을 모르면 null이다. */
  readonly assessmentRate: string | null;
  /** 기초금액 대비 %. 소수 셋째 자리 이상, 끝의 0은 셋째 자리까지만 남긴다. */
  readonly baseRelative: string;
  /** "7,761,885원"처럼 보이는 확인용 금액이다. */
  readonly amount: string;
  /** 복사 값이다. 쉼표·단위 없는 원 단위 숫자다. */
  readonly amountCopy: string;
};

type Position = {
  readonly amount: { readonly amount: string };
  readonly baseRelativeRate: { readonly value: string };
};

const DISPLAY_SCALE = 3;
const GROUPING = /\B(?=(\d{3})+(?!\d))/g;

const ZERO = BigInt(0);
const TEN = BigInt(10);

/** 10의 거듭제곱이다. 이 앱의 컴파일 대상(ES2020 미만)은 bigint 리터럴과 bigint `**`를 받지 않는다. */
function powerOfTen(exponent: number): bigint {
  let value = BigInt(1);
  for (let index = 0; index < exponent; index += 1) value *= TEN;
  return value;
}

function parseDecimal(text: string): { readonly units: bigint; readonly scale: number } | null {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (match === null) return null;
  const fraction = match[2] ?? '';
  return { units: BigInt(`${match[1]}${fraction}`), scale: fraction.length };
}

function scaledText(units: bigint, scale: number): string {
  const digits = units.toString().padStart(scale + 1, '0');
  return `${digits.slice(0, digits.length - scale)}.${digits.slice(digits.length - scale)}`;
}

/**
 * 사정률(%) = 기초금액 대비 % ÷ 하한율 × 100. 서버는 기초금액 대비 %가 하한율 × 배수로 정확히 끝나는 값만 내므로(bid-position-rule)
 * 이 나눗셈은 소수 셋째 자리에서 나누어떨어진다. 떨어지지 않으면 전제가 깨진 값이라 반올림해 보이지 않고 null을 낸다.
 */
export function assessmentRateText(baseRelative: string, floorRate: string): string | null {
  const relative = parseDecimal(baseRelative);
  const floor = parseDecimal(floorRate);
  if (relative === null || floor === null || floor.units === ZERO) return null;
  // rate × 10^3 = relative × 100 × 10^3 / floor = relative.units × 10^(floor.scale + 5) / (floor.units × 10^relative.scale)
  const numerator = relative.units * powerOfTen(floor.scale + 2 + DISPLAY_SCALE);
  const denominator = floor.units * powerOfTen(relative.scale);
  if (numerator % denominator !== ZERO) return null;
  return scaledText(numerator / denominator, DISPLAY_SCALE);
}

/** 끝의 0을 셋째 자리까지만 남긴다. 88.6410 → 88.641, 90.0000 → 90.000. */
function displayDecimal(text: string): string {
  const [whole, fraction = ''] = text.split('.');
  const trimmed = fraction.replace(/0+$/, '');
  return `${whole}.${trimmed.padEnd(DISPLAY_SCALE, '0')}`;
}

export function bidFigure(position: Position, floorRate: string | null): BidFigure {
  const whole = position.amount.amount.split('.')[0]!;
  return {
    assessmentRate: floorRate === null ? null : assessmentRateText(position.baseRelativeRate.value, floorRate),
    baseRelative: displayDecimal(position.baseRelativeRate.value),
    amount: `${whole.replace(GROUPING, ',')}원`,
    amountCopy: whole
  };
}
