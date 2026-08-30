import { Temporal } from "./temporal.js";

const canonicalInstantPattern = /^(?:\d{4}|[+-]\d{6})-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;

/** 저장·wire 시각은 같은 Instant가 여러 문자열로 표현되지 않도록 Temporal 정규 UTC 표현만 받는다. */
export function parseInstantText(value: string): Temporal.Instant {
  if (!canonicalInstantPattern.test(value)) {
    throw new RangeError("Instant text must be a canonical UTC ISO 8601 string");
  }

  const instant = Temporal.Instant.from(value);
  if (instant.toString() !== value) {
    throw new RangeError("Instant text must match Temporal's canonical UTC representation");
  }

  return instant;
}

export const formatInstantText = (instant: Temporal.Instant): string => instant.toString();
