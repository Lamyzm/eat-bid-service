/** @module 책임: 관측된 낙찰 행과 원본 순위로 읽은 차순위 사정률을 담는 계약을 소유한다. */
import { z } from "zod";

import { instantTextSchema } from "../../../atoms/instant";
import { moneyWireSchema } from "../../../values/money";
import { observedBidRateWireSchema } from "../../../values/rate";
import { sourceCodedValueSchema } from "../../../values/source-coded-value";
import { normalizedSupplierAccountSchema } from "./supplier-account";

// 2등은 계산이 아니라 원본 RNK=2 관측값이다. "유효 투찰 중 두 번째"로 다시 세면 하한 판정을 우리가
// 만들게 되고, 그것이 AGENTS 3이 금지하는 해석이다. 두 비율은 명단 행의 `SAJEONG_PCT`를 그대로
// 옮긴 값이라 같은 관측 타입이어야 하며, 낙찰 행이 100을 넘는 것도 소스가 내린 결정이므로
// 상한으로 격리하지 않는다.
export const normalizedAwardDecisionSchema = z.strictObject({
  supplierAccount: normalizedSupplierAccountSchema,
  awardedAt: instantTextSchema.nullable(),
  awardedRate: observedBidRateWireSchema,
  awardedAmount: moneyWireSchema,
  runnerUpRate: observedBidRateWireSchema.nullable(),
  sourceStatus: sourceCodedValueSchema,
}).meta({
  id: "NormalizedAwardDecision",
  description: "The single observed award row and the observed runner-up rate by source rank.",
});

export type NormalizedAwardDecision = z.infer<typeof normalizedAwardDecisionSchema>;
