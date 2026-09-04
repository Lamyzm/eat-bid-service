/** @module 책임: 입찰 명단 한 행의 관측값과 소스 판정 코드를 해석 없이 담는 계약을 소유한다. */
import { z } from "zod";

import { nonNegativeCountSchema } from "../../../atoms/count";
import { instantTextSchema } from "../../../atoms/instant";
import { sourceCodeSchema } from "../../../atoms/source-code";
import { moneyWireSchema } from "../../../values/money";
import { bidRateWireSchema } from "../../../values/rate";
import { sourceCodedValueSchema } from "../../../values/source-coded-value";
import { normalizedSupplierAccountSchema } from "./supplier-account";

export const normalizedBidSubmissionSchema = z.strictObject({
  supplierAccount: normalizedSupplierAccountSchema,
  submittedAt: instantTextSchema.nullable(),
  amount: moneyWireSchema,
  effectiveAmount: moneyWireSchema.nullable(),
  bidRate: bidRateWireSchema,
  rank: nonNegativeCountSchema.nullable(),
  // 2026-09-04 실측에서 BID_STT는 002(낙찰)와 005(낙찰실패) 둘뿐이다. 소스에 "무효"도 "하한미달"도
  // 없으므로 판정을 코드 그대로 싣고 파서가 상태를 만들어내지 않는다.
  sourceStatus: sourceCodedValueSchema,
  // ADR 0029: 이 값의 채움률은 수집 나이의 함수다. 비율의 분모로 쓸 때 코호트 성숙도를 병기한다.
  withdrawalFlag: sourceCodedValueSchema.nullable(),
  drawNumbers: z.array(sourceCodeSchema).max(8),
  observedRosterSize: nonNegativeCountSchema.nullable(),
}).meta({
  id: "NormalizedBidSubmission",
  description: "One observed roster row; source judgement stays a code and is never mapped to a derived status.",
});

export type NormalizedBidSubmission = z.infer<typeof normalizedBidSubmissionSchema>;
