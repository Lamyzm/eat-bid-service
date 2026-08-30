import { formatInstantText, parseInstantText, Temporal } from "@eatbid/domain";
import { z } from "zod";

import { instantTextSchema } from "../atoms/instant";

export const instantCodec = z.codec(
  instantTextSchema,
  z.custom<Temporal.Instant>((value) => value instanceof Temporal.Instant),
  {
    decode: parseInstantText,
    encode: formatInstantText,
  },
);
