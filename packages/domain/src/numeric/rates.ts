/** @module 책임: 분모가 다른 비율들을 서로 섞이지 않는 타입으로 나누고 정확한 scale 변환만 허용한다. */
import {
  canonicalDecimal,
  MAX_DECIMAL_SCALE,
  type CanonicalDecimal,
} from "./canonical-decimal.js";

declare const percentagePointsBrand: unique symbol;
declare const ratioBrand: unique symbol;
declare const bidRateBrand: unique symbol;
declare const observedBidRateBrand: unique symbol;
declare const baseRelativeBidRateBrand: unique symbol;
declare const floorRateBrand: unique symbol;
declare const sharePercentBrand: unique symbol;

export type PercentagePoints = CanonicalDecimal & {
  readonly [percentagePointsBrand]: "PercentagePoints";
};

export type Ratio = CanonicalDecimal & {
  readonly [ratioBrand]: "Ratio";
};

export type BidRate = PercentagePoints & {
  readonly [bidRateBrand]: "BidRate";
};

/** 예정가격 분모의 원천 관측은 100을 넘을 수 있어 bounded PercentagePoints와 분리한다. */
export type ObservedBidRate = CanonicalDecimal & {
  readonly [observedBidRateBrand]: "ObservedBidRate";
};

/**
 * 투찰률 축이다. 단위는 관측 사정률(`ObservedBidRate`)과 같은 percentage-points지만 분모가 예정가격이 아니라
 * 기초금액이라 같은 축의 값이 아니다. 두 값을 한 타입으로 묶으면 화면이 다른 분모의 수를 나란히
 * 비교하게 된다(AGENTS 15).
 */
export type BaseRelativeBidRate = CanonicalDecimal & {
  readonly [baseRelativeBidRateBrand]: "BaseRelativeBidRate";
};

export type FloorRate = PercentagePoints & {
  readonly [floorRateBrand]: "FloorRate";
};

export type SharePercent = PercentagePoints & {
  readonly [sharePercentBrand]: "SharePercent";
};

export interface ExactRateConversionOptions {
  readonly sourceScale: number;
  readonly targetScale: number;
  readonly rounding: "reject";
}

const decimalPartsPattern = /^(0|[1-9]\d*)(?:\.(\d+))?$/;
const MAX_RATE_COEFFICIENT_SHIFT = MAX_DECIMAL_SCALE + 2;

function assertAtMost(value: CanonicalDecimal, maximumInteger: "1" | "100"): void {
  const match = decimalPartsPattern.exec(value);
  if (match === null) {
    throw new RangeError("Rate must be a canonical nonnegative decimal");
  }

  const integer = match[1];
  const fraction = match[2] ?? "";
  const exceedsInteger =
    integer.length > maximumInteger.length ||
    (integer.length === maximumInteger.length && integer > maximumInteger);
  const exceedsAtBoundary = integer === maximumInteger && /[1-9]/.test(fraction);

  if (exceedsInteger || exceedsAtBoundary) {
    throw new RangeError(`Rate must be between 0 and ${maximumInteger}`);
  }
}

/** 퍼센트포인트와 ratio는 같은 문자열이어도 분모가 다르므로 named factory에서만 brand한다. */
export function percentagePoints(value: CanonicalDecimal): PercentagePoints {
  assertAtMost(value, "100");
  return value as PercentagePoints;
}

export function ratio(value: CanonicalDecimal): Ratio {
  assertAtMost(value, "1");
  return value as Ratio;
}

export function bidRate(value: CanonicalDecimal): BidRate {
  assertAtMost(value, "100");
  return value as BidRate;
}

/** 원천 관측을 절단하지 않되 canonical wire와 numeric(15,3)의 정밀도 경계는 유지한다. */
export function observedBidRate(value: CanonicalDecimal): ObservedBidRate {
  canonicalDecimal(value, 3);
  if (value.length > 16) {
    throw new RangeError("Observed bid rate must have at most twelve integer digits");
  }
  return value as ObservedBidRate;
}

/**
 * 상한을 두지 않는다. 예정가격이 기초금액보다 크면 이 값이 100을 넘고 그것은 오류가 아니라 관측
 * 가능한 상태다(AGENTS 3). 정밀도는 호출자가 넘기는 `canonicalDecimal`의 scale이 고정한다.
 */
export function baseRelativeBidRate(value: CanonicalDecimal): BaseRelativeBidRate {
  return value as BaseRelativeBidRate;
}

export function floorRate(value: CanonicalDecimal): FloorRate {
  assertAtMost(value, "100");
  return value as FloorRate;
}

export function sharePercent(value: CanonicalDecimal): SharePercent {
  assertAtMost(value, "100");
  return value as SharePercent;
}

function assertConversionOptions(options: ExactRateConversionOptions): void {
  assertSupportedScale(options.sourceScale, "sourceScale");
  assertSupportedScale(options.targetScale, "targetScale");

  if (options.rounding !== "reject") {
    throw new RangeError('Rate conversion rounding must be "reject"');
  }
}

function assertSupportedScale(scale: number, name: "sourceScale" | "targetScale"): void {
  if (!Number.isSafeInteger(scale) || scale < 0 || scale > MAX_DECIMAL_SCALE) {
    throw new RangeError(`Rate conversion ${name} must be between 0 and ${MAX_DECIMAL_SCALE}`);
  }
}

function assertSupportedShift(decimalPower: number): void {
  if (!Number.isSafeInteger(decimalPower) || Math.abs(decimalPower) > MAX_RATE_COEFFICIENT_SHIFT) {
    throw new RangeError(
      `Rate conversion coefficient shift must be between -${MAX_RATE_COEFFICIENT_SHIFT} and ${MAX_RATE_COEFFICIENT_SHIFT}`,
    );
  }
}

function coefficient(value: CanonicalDecimal, scale: number): string {
  canonicalDecimal(value, scale);
  return value.replace(".", "").replace(/^0+(?=\d)/, "");
}

function shiftedCoefficient(value: string, decimalPower: number): string {
  assertSupportedShift(decimalPower);

  if (decimalPower >= 0) {
    return value + "0".repeat(decimalPower);
  }

  const removedLength = -decimalPower;
  const removed = value.slice(-removedLength);
  if (/[1-9]/.test(removed)) {
    throw new RangeError("Rate conversion would lose precision");
  }

  return value.slice(0, -removedLength) || "0";
}

function decimalFromCoefficient(value: string, scale: number): CanonicalDecimal {
  const normalized = value.replace(/^0+(?=\d)/, "");
  if (scale === 0) {
    return canonicalDecimal(normalized, 0);
  }

  const padded = normalized.padStart(scale + 1, "0");
  const boundary = padded.length - scale;
  return canonicalDecimal(`${padded.slice(0, boundary)}.${padded.slice(boundary)}`, scale);
}

/** 100으로 나누는 변환은 문자열 계수 이동만 수행하며 정밀도 손실은 호출자에게 돌려보낸다. */
export function percentagePointsToRatio(
  value: PercentagePoints,
  options: ExactRateConversionOptions,
): Ratio {
  assertConversionOptions(options);
  const decimalPower = options.targetScale - options.sourceScale - 2;
  assertSupportedShift(decimalPower);
  const source = coefficient(value, options.sourceScale);
  const converted = shiftedCoefficient(source, decimalPower);
  return ratio(decimalFromCoefficient(converted, options.targetScale));
}

/** 100을 곱하는 역변환도 명시한 두 scale 사이에서 정확할 때만 허용한다. */
export function ratioToPercentagePoints(
  value: Ratio,
  options: ExactRateConversionOptions,
): PercentagePoints {
  assertConversionOptions(options);
  const decimalPower = options.targetScale + 2 - options.sourceScale;
  assertSupportedShift(decimalPower);
  const source = coefficient(value, options.sourceScale);
  const converted = shiftedCoefficient(source, decimalPower);
  return percentagePoints(decimalFromCoefficient(converted, options.targetScale));
}
