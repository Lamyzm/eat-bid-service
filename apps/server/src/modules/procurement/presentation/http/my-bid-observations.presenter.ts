/** @module 책임: 내 투찰 관측 조회 record를 공개 V1 응답으로 직렬화하는 순수 presenter다. */
import {
  moneyCodec,
  type AuctionProvenance,
  type MyAttemptBidObservation,
  type MyBidObservationSupplier,
  type MyBidObservationsV1Response,
  type MyBidSubmission,
} from "@eatbid/contracts";
import { z } from "zod";
import {
  bigintText,
  codeReferenceWire,
  instantText,
  martBuildLineageWire,
  observedBidRateWire,
} from "../../../../platform/http/wire";
import type {
  MyBidObservationsRecord,
  MyBidObservationsSupplierRecord,
} from "../../application/find-my-bid-observations";
import type {
  OwnBidAttemptRecord,
  OwnBidProvenanceRecord,
  OwnBidSubmissionRecord,
} from "../../application/own-bid-reader";
import { organizationIdToString } from "../../domain/organization-id";

function submission(record: OwnBidSubmissionRecord): MyBidSubmission {
  return {
    // PostgreSQL bigint 식별자는 Number를 거치면 정밀도가 손실되므로 경계에서 십진 문자열로만 직렬화한다.
    submissionId: bigintText(record.submissionId),
    rosterOrdinal: record.rosterOrdinal,
    supplierPartyId: bigintText(record.supplierPartyId),
    sourceSupplierAccountId: bigintText(record.sourceSupplierAccountId),
    sourceCalculatedAmount: z.encode(moneyCodec, record.sourceCalculatedAmount),
    submittedAmount: record.submittedAmount === null ? null : z.encode(moneyCodec, record.submittedAmount),
    bidRate: observedBidRateWire(record.bidRate),
    rank: record.rank,
    submittedAt: instantText(record.submittedAt),
    sourceStatus: codeReferenceWire(record.sourceStatus),
  };
}

function provenance(record: OwnBidProvenanceRecord): AuctionProvenance {
  return {
    sourceSystem: record.sourceSystem,
    observationId: bigintText(record.observationId),
    normalizedRecordId: bigintText(record.normalizedRecordId),
    contentSha256: record.contentSha256,
  };
}

export function toAttemptObservation(record: OwnBidAttemptRecord): MyAttemptBidObservation {
  const attemptId = bigintText(record.attemptId);
  const revisionId = bigintText(record.revisionId);
  const { result } = record;
  switch (result.kind) {
    case "submitted":
      return {
        attemptId,
        revisionId,
        result: {
          kind: "submitted",
          rows: result.rows.map(submission),
          rosterRowCount: result.rosterRowCount,
          observedAt: instantText(result.observedAt),
          provenance: provenance(result.provenance),
        },
      };
    case "absent-from-roster":
      return {
        attemptId,
        revisionId,
        result: {
          kind: "absent-from-roster",
          rosterRowCount: result.rosterRowCount,
          observedAt: instantText(result.observedAt),
          provenance: provenance(result.provenance),
        },
      };
    case "roster-not-observed":
      // 세지 않은 명단 수를 0으로 실으면 관측하지 않은 사실을 관측처럼 말하게 된다.
      return {
        attemptId,
        revisionId,
        result: { kind: "roster-not-observed", provenance: provenance(result.provenance) },
      };
    default:
      return { attemptId, revisionId, result: { kind: "evidence-conflict", reason: result.reason } };
  }
}

/**
 * 대조된 party가 없으면 회차 목록 자리 자체를 만들지 않는다. 빈 배열은 "찾아봤지만 없었다"로 읽히고
 * 그것은 우리가 하지 않은 미참여 판정이다(ADR 0032 §7).
 */
function supplier(record: MyBidObservationsSupplierRecord): MyBidObservationSupplier {
  if (record.kind !== "observed") return { kind: record.kind };
  return {
    kind: "observed",
    supplierPartyId: bigintText(record.supplierPartyId),
    attempts: record.attempts.map(toAttemptObservation),
  };
}

export function toMyBidObservationsResponse(record: MyBidObservationsRecord): MyBidObservationsV1Response {
  return {
    businessId: bigintText(record.registeredBusinessId),
    organizationId: organizationIdToString(record.organizationId),
    supplier: supplier(record.supplier),
    // 계보는 이 응답이 읽은 build 하나가 갖는다. 회차 이력 meta와 같은 조합이라 화면이 두 응답을
    // 같은 계보로 겹칠 수 있는지 스스로 확인한다(ADR 0034).
    meta: martBuildLineageWire(record.lineage),
  };
}
