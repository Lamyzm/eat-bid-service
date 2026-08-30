import { canonicalDecimal, krw, type Money } from "@eatbid/domain";
import { z } from "zod";

import { moneyWireSchema } from "../values/money";

// wire 검증 뒤 domain factory가 scale과 통화 불변식을 다시 소유하므로 codec이 업무 규칙을 복제하지 않는다.
export const moneyCodec = z.codec(
  moneyWireSchema,
  z.custom<Money>(),
  {
    decode: ({ amount }) => krw(canonicalDecimal(amount, 2)),
    encode: ({ amount, currency }) => ({ amount, currency }),
  },
);
