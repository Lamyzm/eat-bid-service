/** @module 책임: 내 사업자의 실제 투찰 관측 한 행과 회차별 결과 상태의 공개 표현을 소유한다. */
import { z } from "zod";

import { nonNegativeCountSchema } from "../../../atoms/count";
import { positiveBigintTextSchema } from "../../../atoms/identifier";
import { instantTextSchema } from "../../../atoms/instant";
import { codeReferenceSchema } from "../../../values/code-reference";
import { moneyWireSchema } from "../../../values/money";
import { auctionProvenanceSchema } from "../../../values/provenance";
import { observedBidRateWireSchema } from "../../../values/rate";

/**
 * 한 회차 명단이 담을 수 있는 행 수의 상한이며 원천 명단 블록 계약과 같은 값이다(ADR 0041 §5).
 * 이 상한은 회차별이다. 여러 회차를 한 번에 묻는다고 해서 전체 행 수에 다시 걸지 않는다 — 그러면
 * 상한이 요청 크기에 따라 달라져 같은 회차가 어떤 요청에서는 초과가 된다.
 */
export const maxOwnRosterRows = 2048;

/**
 * 내 party가 그 회차 명단에 남긴 제출 한 행이다.
 *
 * 사업자등록번호·상호·주소를 싣지 않는다. 이 응답을 부르는 사람은 이미 그 사업자를 등록한
 * 워크스페이스 구성원이라 그 값을 여기서 다시 알 필요가 없고, 요청 경로와 응답이 남는 곳이 늘수록
 * 개인 식별 정보의 사본만 늘어난다(ADR 0032 §7).
 *
 * `sourceSupplierAccountId`를 함께 싣는 이유: 같은 party가 서로 다른 원본 계정으로 참여한 관측이
 * 실재한다. 계정을 지우고 party만 남기면 같은 회차의 두 제출이 근거 없이 하나로 보인다.
 */
export const myBidSubmissionSchema = z.strictObject({
  submissionId: positiveBigintTextSchema,
  rosterOrdinal: nonNegativeCountSchema,
  supplierPartyId: positiveBigintTextSchema,
  sourceSupplierAccountId: positiveBigintTextSchema,
  // BID_CALC_AMT 관측이며 자리표시자가 실재한다. 제출 금액으로 승격하지 않는다(ADR 0041 §2).
  sourceCalculatedAmount: moneyWireSchema,
  // EFT_ALL_AMT 관측 하나뿐이다. 없으면 null이며 계산 금액이나 금액×비율로 복원하지 않는다.
  submittedAmount: moneyWireSchema.nullable(),
  // 예정가격 분모의 원천 SAJEONG_PCT다. 100 초과가 실제로 관측되므로 상한을 두지 않는다(ADR 0040).
  bidRate: observedBidRateWireSchema,
  rank: nonNegativeCountSchema.nullable(),
  submittedAt: instantTextSchema.nullable(),
  sourceStatus: codeReferenceSchema,
}).meta({ id: "MyBidSubmission" });

/**
 * 그 회차의 명단 증거가 스스로 어긋난 이유다. 어긋난 회차 하나가 나머지 회차의 정상 결과를 빈
 * 배열로 덮지 않도록 그 회차만 격리하고 이유를 이름으로 남긴다(AGENTS 3).
 */
export const myBidEvidenceConflictSchema = z.enum([
  "roster-count-mismatch",
  "roster-ordinal-duplicate",
  // 명단 행이 이 revision을 낳은 관측이 아닌 다른 관측을 가리킨다. 상태 라벨은 그 행의 관측에서
  // 읽고 응답의 provenance는 revision의 관측이라, 하나로 포장하면 서로 다른 두 관측이 한 사실처럼
  // 보인다(ADR 0041 §4).
  "roster-observation-mismatch",
  "observation-time-conflict",
  "roster-value-invalid",
]).meta({ id: "MyBidEvidenceConflict" });

/**
 * 한 회차의 결과다. "내 행이 없다"의 세 가지 서로 다른 사실을 한 값으로 합치지 않는다.
 *
 * - `submitted`: 명단에 내 party의 행이 실제로 있다.
 * - `absent-from-roster`: 명단은 관측됐고 그 안에 내 행만 없다.
 * - `roster-not-observed`: 그 revision의 명단 블록 자체가 없다. 자료 없음이지 미참여가 아니다.
 * - `evidence-conflict`: 명단 증거가 어긋나 어느 쪽도 말할 수 없다.
 */
export const myAttemptBidObservationSchema = z.strictObject({
  attemptId: positiveBigintTextSchema,
  revisionId: positiveBigintTextSchema,
  result: z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("submitted"),
      rows: z.array(myBidSubmissionSchema).min(1).max(maxOwnRosterRows),
      // 내 행이 몇 명 가운데 하나였는지는 그 자체가 판단 재료다. 명단 전체를 다시 받지 않고 수만 싣는다.
      rosterRowCount: nonNegativeCountSchema,
      observedAt: instantTextSchema,
      provenance: auctionProvenanceSchema,
    }),
    z.strictObject({
      kind: z.literal("absent-from-roster"),
      rosterRowCount: nonNegativeCountSchema,
      observedAt: instantTextSchema,
      provenance: auctionProvenanceSchema,
    }),
    z.strictObject({
      kind: z.literal("roster-not-observed"),
      provenance: auctionProvenanceSchema,
    }),
    z.strictObject({
      kind: z.literal("evidence-conflict"),
      reason: myBidEvidenceConflictSchema,
    }),
  ]),
}).meta({ id: "MyAttemptBidObservation" });

export type MyBidSubmission = z.infer<typeof myBidSubmissionSchema>;
export type MyAttemptBidObservation = z.infer<typeof myAttemptBidObservationSchema>;
export type MyBidEvidenceConflict = z.infer<typeof myBidEvidenceConflictSchema>;
