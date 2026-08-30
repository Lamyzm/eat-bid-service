declare const elapsedMillisecondsBrand: unique symbol;

export type ElapsedMilliseconds = number & {
  readonly [elapsedMillisecondsBrand]: "ElapsedMilliseconds";
};

/** 타이머 경계에는 단위가 지워지지 않은 안전한 정수 밀리초만 전달한다. */
export function milliseconds(value: number): ElapsedMilliseconds {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError("Elapsed milliseconds must be a nonnegative safe integer");
  }

  return value as ElapsedMilliseconds;
}

function scaled(value: number, factor: number): ElapsedMilliseconds {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError("Elapsed duration must be finite and nonnegative");
  }

  return milliseconds(value * factor);
}

export const seconds = (value: number): ElapsedMilliseconds => scaled(value, 1_000);
export const minutes = (value: number): ElapsedMilliseconds => scaled(value, 60_000);
export const hours = (value: number): ElapsedMilliseconds => scaled(value, 3_600_000);
export const toMilliseconds = (value: ElapsedMilliseconds): number => value;
