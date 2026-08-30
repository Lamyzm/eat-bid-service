declare const canonicalDecimalBrand: unique symbol;

export type CanonicalDecimal = string & {
  readonly [canonicalDecimalBrand]: "CanonicalDecimal";
};

/** PostgreSQL numeric foundation과 동일한 범위에서 scale을 제한해 비정상적인 문자열 할당을 막는다. */
export const MAX_DECIMAL_SCALE = 18;

const canonicalDecimalPattern = /^(0|[1-9]\d*)(?:\.(\d+))?$/;

function assertScale(scale: number): void {
  if (!Number.isSafeInteger(scale) || scale < 0 || scale > MAX_DECIMAL_SCALE) {
    throw new RangeError(`Decimal scale must be between 0 and ${MAX_DECIMAL_SCALE}`);
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
