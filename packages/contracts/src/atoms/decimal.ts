import { z } from "zod";

export const canonicalDecimalTextSchema = z.string()
  .max(37)
  .regex(/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/)
  .meta({
    id: "CanonicalDecimalText",
    description: "Canonical nonnegative decimal text without sign, exponent, or grouping separators.",
  });

export const canonicalMoneyAmountSchema = z.string()
  .max(19)
  .regex(/^(?:0|[1-9][0-9]{0,15})\.[0-9]{2}$/)
  .meta({
    id: "CanonicalMoneyAmount",
    description: "Canonical nonnegative KRW amount with exactly two fractional digits.",
  });

export const percentagePointsTextSchema = z.string()
  .max(10)
  .regex(/^(?:(?:0|[1-9][0-9]?)\.[0-9]{6}|100\.000000)$/)
  .meta({
    id: "PercentagePointsText",
    description: "Canonical percentage-points text from 0.000000 through 100.000000.",
  });

// mart.org_round_summary의 비율 열은 numeric(6,3)이다. 6자리 atom으로 재사용하면 손실 없는 값도
// 패턴 불일치로 거부되므로 원본 정밀도를 그대로 담는 3자리 atom을 별도로 둔다.
export const percentagePoints3TextSchema = z.string()
  .max(7)
  .regex(/^(?:(?:0|[1-9][0-9]?)\.[0-9]{3}|100\.000)$/)
  .meta({
    id: "PercentagePoints3Text",
    description: "Canonical percentage-points text with exactly three fractional digits, "
      + "matching numeric(6,3) mart columns; from 0.000 through 100.000.",
  });

export const ratioTextSchema = z.string()
  .max(8)
  .regex(/^(?:0\.[0-9]{6}|1\.000000)$/)
  .meta({
    id: "RatioText",
    description: "Canonical ratio text from 0.000000 through 1.000000.",
  });
