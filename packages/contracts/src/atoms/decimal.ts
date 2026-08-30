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

export const ratioTextSchema = z.string()
  .max(8)
  .regex(/^(?:0\.[0-9]{6}|1\.000000)$/)
  .meta({
    id: "RatioText",
    description: "Canonical ratio text from 0.000000 through 1.000000.",
  });
