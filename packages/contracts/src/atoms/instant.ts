import { z } from "zod";

export const instantTextSchema = z.iso.datetime({ offset: false })
  .max(35)
  .regex(/^(?:\d{4}|[+-]\d{6})-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.[0-9]{0,8}[1-9])?Z$/)
  .meta({
    id: "InstantText",
    description: "Canonical UTC ISO 8601 instant text ending in Z with at most nanosecond precision.",
    example: "2026-08-30T00:00:00Z",
  });
