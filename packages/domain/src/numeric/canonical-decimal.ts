declare const canonicalDecimalBrand: unique symbol;

export type CanonicalDecimal = string & {
  readonly [canonicalDecimalBrand]: "CanonicalDecimal";
};

const canonicalDecimalPattern = /^(0|[1-9]\d*)(?:\.(\d+))?$/;

function assertScale(scale: number): void {
  if (!Number.isSafeInteger(scale) || scale < 0) {
    throw new RangeError("Decimal scale must be a nonnegative safe integer");
  }
}

/** Number 변환 없이 부호 없는 ASCII 고정 소수 표현과 정확한 scale을 함께 검증한다. */
export function canonicalDecimal(value: string, scale: number): CanonicalDecimal {
  assertScale(scale);
  const match = canonicalDecimalPattern.exec(value);
  const fractionalDigits = match?.[2];

  if (match === null || (scale === 0 ? fractionalDigits !== undefined : fractionalDigits?.length !== scale)) {
    throw new RangeError("Decimal text must be canonical, nonnegative, and match the requested scale");
  }

  return value as CanonicalDecimal;
}
