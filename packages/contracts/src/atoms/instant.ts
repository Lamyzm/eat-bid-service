import { z } from "zod";

export const instantTextSchema = z.string()
  .max(35)
  .regex(/^(?:(?:\d\d[2468][048]|\d\d[13579][26]|\d\d0[48]|[02468][048]00|[13579][26]00)-02-29|\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\d|30)|(?:02)-(?:0[1-9]|1\d|2[0-8])))T(?:(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.[0-9]{0,8}[1-9])?(?:Z))$/)
  .meta({
    id: "InstantText",
    description: "Canonical UTC ISO 8601 instant text ending in Z with at most nanosecond precision.",
    example: "2026-08-30T00:00:00Z",
  });
