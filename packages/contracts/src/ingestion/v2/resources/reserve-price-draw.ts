/** @module 책임: 복수예정가격 추첨 후보와 소스가 표시한 선택 여부를 관측 그대로 담는 계약을 소유한다. */
import { z } from "zod";

import { sourceCodeSchema } from "../../../atoms/source-code";
import { moneyWireSchema } from "../../../values/money";
import { reservePriceRatioWireSchema } from "../../../values/rate";
import { sourceCodedValueSchema } from "../../../values/source-coded-value";

// 추첨된 후보의 평균이 예정가격과 같다는 것은 999/999로 확인된 소스 불변식이다. 그래도 예정가격은
// ds_info.ELCTRN_BID_PLNPRC 관측값을 싣는다. 여기서 평균을 계산해 채우면 관측과 해석이 섞인다.
export const normalizedReservePriceDrawSchema = z.strictObject({
  candidates: z.array(z.strictObject({
    // 순번은 셈이 아니라 후보를 가리키는 소스 코드다. 명단 행의 drawNumbers가 이 순번을 가리키므로
    // 두 값이 같은 타입이어야 하고, 정수로 담으면 소스가 "07"을 보내는 날 record 전체가 격리된다.
    sequence: sourceCodeSchema,
    ratio: reservePriceRatioWireSchema,
    amount: moneyWireSchema,
    chosen: sourceCodedValueSchema,
  })).max(64),
}).meta({
  id: "NormalizedReservePriceDraw",
  description: "Observed multiple-reserve-price candidates and which of them the source marked chosen.",
});

export type NormalizedReservePriceDraw = z.infer<typeof normalizedReservePriceDrawSchema>;
