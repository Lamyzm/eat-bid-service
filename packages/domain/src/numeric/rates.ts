import {
  canonicalDecimal,
  MAX_DECIMAL_SCALE,
  type CanonicalDecimal,
} from "./canonical-decimal.js";

declare const percentagePointsBrand: unique symbol;
declare const ratioBrand: unique symbol;
declare const bidRateBrand: unique symbol;
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
