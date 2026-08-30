import { z } from "zod";

export const instantTextSchema = z.string()
  .max(35)
  .regex(/^(?:(?:[0-9][0-9][2468][048]|[0-9][0-9][13579][26]|[0-9][0-9]0[48]|[02468][048]00|[13579][26]00)-02-29|[0-9]{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12][0-9]|3[01])|(?:0[469]|11)-(?:0[1-9]|[12][0-9]|30)|(?:02)-(?:0[1-9]|1[0-9]|2[0-8])))T(?:(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\.[0-9]{0,8}[1-9])?(?:Z))$/)
  .meta({
    id: "InstantText",
    description: "Canonical UTC ISO 8601 instant text ending in Z with at most nanosecond precision.",
    example: "2026-08-30T00:00:00Z",
  });
