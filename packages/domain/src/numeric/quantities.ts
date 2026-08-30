declare const expectedRecordCountBrand: unique symbol;
declare const capturedRecordCountBrand: unique symbol;
declare const publishedRecordCountBrand: unique symbol;
declare const sampleCountBrand: unique symbol;
declare const byteLengthBrand: unique symbol;
declare const payloadByteLimitBrand: unique symbol;

export type ExpectedRecordCount = bigint & {
  readonly [expectedRecordCountBrand]: "ExpectedRecordCount";
};

export type CapturedRecordCount = bigint & {
  readonly [capturedRecordCountBrand]: "CapturedRecordCount";
};

export type PublishedRecordCount = bigint & {
  readonly [publishedRecordCountBrand]: "PublishedRecordCount";
};

export type SampleCount = bigint & {
  readonly [sampleCountBrand]: "SampleCount";
};

export type ByteLength = bigint & {
  readonly [byteLengthBrand]: "ByteLength";
};

export type PayloadByteLimit = number & {
  readonly [payloadByteLimitBrand]: "PayloadByteLimit";
};

function nonnegativeBigint<T extends bigint>(value: bigint, name: string): T {
  if (value < 0n) {
    throw new RangeError(`${name} must be nonnegative`);
  }

  return value as T;
}

/** 완전성 대조의 grain을 잃지 않도록 기대·수집·발행 건수를 서로 다른 nominal 값으로 만든다. */
export const expectedRecordCount = (value: bigint): ExpectedRecordCount =>
  nonnegativeBigint<ExpectedRecordCount>(value, "Expected record count");

export const capturedRecordCount = (value: bigint): CapturedRecordCount =>
  nonnegativeBigint<CapturedRecordCount>(value, "Captured record count");

export const publishedRecordCount = (value: bigint): PublishedRecordCount =>
  nonnegativeBigint<PublishedRecordCount>(value, "Published record count");

export const sampleCount = (value: bigint): SampleCount =>
  nonnegativeBigint<SampleCount>(value, "Sample count");

export const byteLength = (value: bigint): ByteLength =>
  nonnegativeBigint<ByteLength>(value, "Byte length");

/** Node 경계의 payload 제한만 number를 쓰되 무손실 범위를 factory가 보장한다. */
export function payloadByteLimit(value: number): PayloadByteLimit {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError("Payload byte limit must be a nonnegative safe integer");
  }

  return value as PayloadByteLimit;
}
