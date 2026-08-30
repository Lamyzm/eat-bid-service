import { formatInstantText, parseInstantText, Temporal } from "@eatbid/domain";
import { z } from "zod";

import { instantTextSchema } from "../atoms/instant";

const isEncodableInstant = (value: unknown): value is Temporal.Instant =>
  value instanceof Temporal.Instant
  && instantTextSchema.safeParse(formatInstantText(value)).success;

export const instantCodec = z.codec(
  instantTextSchema,
  z.custom<Temporal.Instant>(isEncodableInstant),
  {
    decode: parseInstantText,
    encode: formatInstantText,
  },
);
