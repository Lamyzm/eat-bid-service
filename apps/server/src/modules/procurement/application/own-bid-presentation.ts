/** @module 책임: 내부 투찰 관측 record를 공개 V1 응답 값으로 직렬화한다. */
import {
  instantCodec,
  moneyCodec,
  type AuctionProvenance,
  type MyAttemptBidObservation,
  type MyBidObservationSupplier,
  type MyBidObservationsV1Response,
  type MyBidSubmission,
} from "@eatbid/contracts";
import { z } from "zod";
import type { MartBuildLineage } from "./mart-build-lineage";
import type {
  OwnBidAttemptRecord,
  OwnBidProvenanceRecord,
  OwnBidSubmissionRecord,
} from "./own-bid-reader";
import { organizationIdToString, type OrganizationId } from "../domain/organization-id";

function submission(record: OwnBidSubmissionRecord): MyBidSubmission {
  return {
    // PostgreSQL bigint 식별자는 Number를 거치면 정밀도가 손실되므로 경계에서 십진 문자열로만 직렬화한다.
    submissionId: record.submissionId.toString(10),
    rosterOrdinal: record.rosterOrdinal,
    supplierPartyId: record.supplierPartyId.toString(10),
    sourceSupplierAccountId: record.sourceSupplierAccountId.toString(10),
    sourceCalculatedAmount: z.encode(moneyCodec, record.sourceCalculatedAmount),
    submittedAmount: record.submittedAmount === null ? null : z.encode(moneyCodec, record.submittedAmount),
    // scale과 100 초과 허용은 어댑터의 observedBidRateValue가 이미 닫았다. 여기서 다시 만들지 않는다.
    bidRate: { value: record.bidRate, unit: "percentage-points" },
    rank: record.rank,
    submittedAt: record.submittedAt === null ? null : z.encode(instantCodec, record.submittedAt),
    sourceStatus: {
      ...record.sourceStatus,
      codeValueId: record.sourceStatus.codeValueId.toString(10),
    },
  };
}

function provenance(record: OwnBidProvenanceRecord): AuctionProvenance {
  return {
    sourceSystem: record.sourceSystem,
    observationId: record.observationId.toString(10),
    normalizedRecordId: record.normalizedRecordId.toString(10),
    contentSha256: record.contentSha256,
  };
}

export function toAttemptObservation(record: OwnBidAttemptRecord): MyAttemptBidObservation {
  const attemptId = record.attemptId.toString(10);
  const revisionId = record.revisionId.toString(10);
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
          observedAt: z.encode(instantCodec, result.observedAt),
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
          observedAt: z.encode(instantCodec, result.observedAt),
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

export function toMyBidObservationsResponse(input: {
  readonly registeredBusinessId: bigint;
  readonly organizationId: OrganizationId;
  readonly supplier: MyBidObservationSupplier;
  readonly lineage: MartBuildLineage;
}): MyBidObservationsV1Response {
  return {
    businessId: input.registeredBusinessId.toString(10),
    organizationId: organizationIdToString(input.organizationId),
    supplier: input.supplier,
    // 계보는 이 응답이 읽은 build 하나가 갖는다. 회차 이력 meta와 같은 조합이라 화면이 두 응답을
    // 같은 계보로 겹칠 수 있는지 스스로 확인한다(ADR 0034).
    meta: {
      buildId: input.lineage.buildId.toString(10),
      sourceReleaseId: input.lineage.sourceReleaseId,
      calcVersion: input.lineage.calcVersion,
      computedAt: z.encode(instantCodec, input.lineage.computedAt),
      coverage: input.lineage.coverage,
      regionScheme: input.lineage.regionScheme,
    },
  };
}
