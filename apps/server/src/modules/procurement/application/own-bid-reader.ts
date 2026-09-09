/**
 * @module 책임: 고정한 build의 여러 회차에서 한 SupplierParty의 실제 투찰 관측을 한 번에 읽는 port와
 * 그 회차별 결과 record를 정의한다.
 *
 * 회차마다 명단 port를 부르지 않는 이유는 화면 하나가 60회차를 그리기 때문이다. 회차 수만큼 왕복하면
 * 그 왕복들이 서로 다른 시점을 보고, 사용자는 한 화면 안에서 서로 다른 사실을 겹쳐 보게 된다.
 */
import type { MyBidEvidenceConflict } from "@eatbid/contracts";
import type { Money, ObservedBidRate, Temporal } from "@eatbid/domain";
import type { TransactionHandle } from "../../../platform/database/unit-of-work";
import type { CodeReferenceRecord } from "./auction-reader";
import type { MartBuildLineage } from "./mart-build-lineage";
import type { OrganizationId } from "../domain/organization-id";

/** 요청이 지정한 회차 좌표다. revision을 함께 받아야 최신 해석으로 조용히 바뀌지 않는다. */
export interface OwnBidAttemptKey {
  readonly attemptId: bigint;
  readonly revisionId: bigint;
}

/** 그 회차 명단이 나온 원본 증거다. 명단이 비어 있어도 revision 자체의 증거는 남는다. */
export interface OwnBidProvenanceRecord {
  readonly sourceSystem: string;
  readonly observationId: bigint;
  readonly normalizedRecordId: bigint;
  readonly contentSha256: string;
}

/**
 * 내 party가 그 명단에 남긴 제출 한 행이다. 같은 party가 서로 다른 원본 계정으로 참여한 관측이
 * 실재하므로 계정 식별자를 지우지 않는다(ADR 0033 §1).
 */
export interface OwnBidSubmissionRecord {
  readonly submissionId: bigint;
  readonly rosterOrdinal: number;
  readonly supplierPartyId: bigint;
  readonly sourceSupplierAccountId: bigint;
  /** `BID_CALC_AMT` 관측이며 자리표시자가 실재한다(ADR 0041 §2). */
  readonly sourceCalculatedAmount: Money;
  /** `EFT_ALL_AMT` 관측 하나다. 없으면 null이며 계산 금액으로 대체하지 않는다. */
  readonly submittedAmount: Money | null;
  readonly bidRate: ObservedBidRate;
  readonly rank: number | null;
  readonly submittedAt: Temporal.Instant | null;
  readonly sourceStatus: CodeReferenceRecord;
}

/**
 * "내 행이 없다"의 세 가지 사실을 하나로 합치지 않는다. 명단에 없는 것, 명단 자체가 없는 것, 증거가
 * 어긋나 판정할 수 없는 것은 사용자가 할 일이 서로 다르다(AGENTS 3).
 */
export type OwnBidAttemptResult =
  | {
    readonly kind: "submitted";
    readonly rows: readonly OwnBidSubmissionRecord[];
    readonly rosterRowCount: number;
    readonly observedAt: Temporal.Instant;
    readonly provenance: OwnBidProvenanceRecord;
  }
  | {
    readonly kind: "absent-from-roster";
    readonly rosterRowCount: number;
    readonly observedAt: Temporal.Instant;
    readonly provenance: OwnBidProvenanceRecord;
  }
  | { readonly kind: "roster-not-observed"; readonly provenance: OwnBidProvenanceRecord }
  | { readonly kind: "evidence-conflict"; readonly reason: MyBidEvidenceConflict };

export interface OwnBidAttemptRecord {
  readonly attemptId: bigint;
  readonly revisionId: bigint;
  readonly result: OwnBidAttemptResult;
}

export interface OwnBidQuery {
  /**
   * 원본이 아직 관측하지 않은 사업자는 null이다. 그때도 build와 회차 조합은 확인해야 하므로 조회를
   * 건너뛰지 않는다. 어떤 party 행과도 일치하지 않는 조건이 되어 내 행은 하나도 고르지 않는다.
   */
  readonly supplierPartyId: bigint | null;
  readonly organizationId: OrganizationId;
  /** 소비자가 회차 이력 응답에서 받은 build다. 이 값이 활성이 아니면 읽지 않는다. */
  readonly buildId: bigint;
  readonly attempts: readonly OwnBidAttemptKey[];
}

/**
 * 요청 조합이 그 build·그 기관의 mart에 없으면 결과 목록에서 조용히 빼지 않는다. 빼면 소비자는
 * "그 회차엔 투찰이 없었다"로 읽지만 실제로는 우리가 그 회차를 그 build에서 찾지 못한 것이다.
 */
export type OwnBidListing =
  | {
    readonly kind: "observations";
    readonly lineage: MartBuildLineage;
    readonly attempts: readonly OwnBidAttemptRecord[];
  }
  | { readonly kind: "build-changed"; readonly activeBuildId: bigint | null }
  | { readonly kind: "attempts-not-in-build"; readonly missing: readonly OwnBidAttemptKey[] };

export interface OwnBidReader {
  read(snapshot: TransactionHandle, query: OwnBidQuery): Promise<OwnBidListing>;
}
