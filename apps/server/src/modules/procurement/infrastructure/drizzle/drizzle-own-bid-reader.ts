/**
 * @module 책임: 개인 투찰 조회 port를 활성 build 확인과 batch SQL 한 번으로 구현하고, 명단 근거가
 * 어긋난 회차를 그 회차 안에서만 격리한다.
 *
 * 어긋난 회차 하나로 요청 전체를 실패시키지 않는 이유: 60회차 화면에서 한 회차의 원본 증거가 깨졌다고
 * 나머지 59회차의 정상 관측까지 보이지 않으면, 사용자는 그 화면이 왜 비었는지 알 수 없다. 격리는
 * 감추는 것이 아니라 이름을 붙여 남기는 것이다(AGENTS 3).
 */
import type { MyBidEvidenceConflict } from "@eatbid/contracts";
import type { Temporal } from "@eatbid/domain";
import type {
  OwnBidAttemptKey,
  OwnBidAttemptRecord,
  OwnBidAttemptResult,
  OwnBidListing,
  OwnBidProvenanceRecord,
  OwnBidQuery,
  OwnBidReader,
  OwnBidSubmissionRecord,
} from "../../application/own-bid-reader";
import { transactionDatabase, type TransactionHandle } from "../../../../platform/database/unit-of-work";
import { MAX_ROSTER_ROWS } from "../../domain/roster-limits";
import { postgresInstant, type AuctionReadDatabase } from "./drizzle-auction-reader";
import { ORG_ROUND_SUMMARY, readActiveMartBuildLineage } from "./drizzle-mart-build-reader";
import { ownBidQuery } from "./own-bid-query";
import { bigintValue, moneyValue, observedBidRateValue } from "./postgres-row-values";

type DbId = string | bigint;
type PostgresTimestamp = Parameters<typeof postgresInstant>[0];

type OwnBidRow = Readonly<{
  auction_attempt_id: DbId; auction_revision_id: DbId;
  observation_id: DbId; normalized_record_id: DbId; content_sha256: string; source_system: string;
  expected_count: number | null; row_count: number | null; ordinal_count: number | null;
  foreign_observation_count: number | null;
  // 관측 시각만 text로 건너온다. driver의 `Date`는 밀리초까지만 담아 원본의 마이크로초를 잃는다.
  observed_at: string | null; observed_at_count: number | null;
  submission_id: DbId | null; roster_ordinal: number | null;
  supplier_party_id: DbId | null; source_supplier_account_id: DbId | null;
  amount: string | null; effective_amount: string | null; currency: string | null;
  bid_rate: string | null; rank: number | null; submitted_at: PostgresTimestamp;
  status_id: DbId | null; status_code: string | null; status_scheme: string | null; status_label: string | null;
}>;

/** 명단 근거가 스스로 어긋난 회차의 이유다. 값이 없으면 그 회차는 읽을 수 있는 상태다. */
function conflictOf(row: OwnBidRow): MyBidEvidenceConflict | null {
  const rowCount = row.row_count ?? 0;
  if (rowCount > MAX_ROSTER_ROWS) return "roster-count-mismatch";
  // sourceRosterSize는 다른 블록의 관측이라 대조 대상이 아니다. 정규화된 명단 배열만 견준다.
  if (row.expected_count !== null && row.expected_count !== rowCount) return "roster-count-mismatch";
  if (row.expected_count === null && rowCount !== 0) return "roster-count-mismatch";
  if ((row.ordinal_count ?? 0) !== rowCount) return "roster-ordinal-duplicate";
  // 명단 전체에 적용한다. 내 party 행만 보면 남의 행이 다른 관측을 가리켜도 통과시켜, 명단 자체가
  // 어긋난 회차를 근거로 "내 행은 없었다"를 확정하게 된다.
  if ((row.foreign_observation_count ?? 0) > 0) return "roster-observation-mismatch";
  if (rowCount === 0) return null;
  // 근거가 없거나 여러 시각으로 갈리면 어느 쪽이 이 회차의 관측인지 말할 수 없다. 하나를 고르면
  // 화면이 관측하지 않은 시각을 원본 관측으로 읽는다(ADR 0041 §4).
  if (row.observed_at_count !== 1 || row.observed_at === null) return "observation-time-conflict";
  return null;
}

function provenanceOf(row: OwnBidRow): OwnBidProvenanceRecord {
  return {
    sourceSystem: row.source_system,
    observationId: bigintValue(row.observation_id),
    normalizedRecordId: bigintValue(row.normalized_record_id),
    contentSha256: row.content_sha256,
  };
}

function label(value: string | null): string | null {
  return value === null || value.trim() === "" ? null : value.trim();
}

function submissionOf(row: OwnBidRow): OwnBidSubmissionRecord {
  const rate = observedBidRateValue(row.bid_rate);
  if (row.submission_id === null || row.supplier_party_id === null
    || row.source_supplier_account_id === null || row.roster_ordinal === null
    || row.status_id === null || row.status_code === null || row.status_scheme === null
    || rate === null || row.currency === null) {
    throw new TypeError("Own submission row is missing required observations");
  }
  return {
    submissionId: bigintValue(row.submission_id),
    rosterOrdinal: row.roster_ordinal,
    supplierPartyId: bigintValue(row.supplier_party_id),
    sourceSupplierAccountId: bigintValue(row.source_supplier_account_id),
    sourceCalculatedAmount: moneyValue(row.amount, row.currency, true),
    submittedAmount: moneyValue(row.effective_amount, row.currency, false),
    bidRate: rate,
    rank: row.rank,
    submittedAt: postgresInstant(row.submitted_at),
    sourceStatus: {
      codeValueId: bigintValue(row.status_id),
      code: row.status_code,
      scheme: row.status_scheme,
      label: label(row.status_label),
    },
  };
}

function observedInstant(row: OwnBidRow): Temporal.Instant {
  const observedAt = postgresInstant(row.observed_at);
  if (observedAt === null) throw new TypeError("Roster observation timestamp is missing");
  return observedAt;
}

function resultOf(rows: readonly OwnBidRow[]): OwnBidAttemptResult {
  // 회차마다 최소 한 행이 온다. 내 행이 없으면 명단 근거만 실린 행 하나다.
  const header = rows[0]!;
  const conflict = conflictOf(header);
  if (conflict !== null) return { kind: "evidence-conflict", reason: conflict };
  const provenance = provenanceOf(header);
  const rosterRowCount = header.row_count ?? 0;
  // 빈 명단은 원본 블록 부재와 실제 0명을 구별할 근거가 없다. 미참여로 바꿔 말하지 않는다(ADR 0041 §5).
  if (rosterRowCount === 0) return { kind: "roster-not-observed", provenance };
  const observedAt = observedInstant(header);
  const own = rows.filter((row) => row.submission_id !== null).map(submissionOf);
  return own.length === 0
    ? { kind: "absent-from-roster", rosterRowCount, observedAt, provenance }
    : { kind: "submitted", rows: own, rosterRowCount, observedAt, provenance };
}

function attemptRecord(key: OwnBidAttemptKey, rows: readonly OwnBidRow[]): OwnBidAttemptRecord {
  try {
    return { attemptId: key.attemptId, revisionId: key.revisionId, result: resultOf(rows) };
  } catch {
    // 의미 값 하나가 계약을 만족하지 못하면 그 회차는 읽을 수 없다. 다른 회차의 결과는 그대로 남긴다.
    return {
      attemptId: key.attemptId,
      revisionId: key.revisionId,
      result: { kind: "evidence-conflict", reason: "roster-value-invalid" },
    };
  }
}

export class DrizzleOwnBidReader implements OwnBidReader {
  async read(snapshot: TransactionHandle, query: OwnBidQuery): Promise<OwnBidListing> {
    const database = transactionDatabase(snapshot) as AuctionReadDatabase;
    // 소비자가 회차 이력에서 받은 build가 아직 활성인지 먼저 본다. 다르면 화면의 표와 점이 서로 다른
    // 계보를 말하게 되므로 새 build에서 조용히 읽지 않는다(ADR 0034).
    const lineage = await readActiveMartBuildLineage(database, ORG_ROUND_SUMMARY);
    if (lineage === null || lineage.buildId !== query.buildId) {
      return { kind: "build-changed", activeBuildId: lineage?.buildId ?? null };
    }
    const result = await database.execute(ownBidQuery({
      // 미관측 사업자에게도 build와 조합 검증은 해야 하므로 조회를 건너뛰지 않는다.
      supplierPartyId: query.supplierPartyId,
      organizationId: query.organizationId,
      buildId: query.buildId,
      attempts: query.attempts,
    }));
    const grouped = new Map<string, OwnBidRow[]>();
    for (const row of Array.isArray(result) ? result as OwnBidRow[] : []) {
      const key = bigintValue(row.auction_attempt_id).toString(10);
      grouped.set(key, [...grouped.get(key) ?? [], row]);
    }
    // 이 build와 이 기관의 요약에 없는 조합은 결과에서 조용히 빼지 않는다. 빼면 소비자가 "그 회차엔
    // 투찰이 없었다"로 읽지만 실제로는 우리가 그 회차를 찾지 못한 것이다.
    const missing = query.attempts.filter((attempt) => !grouped.has(attempt.attemptId.toString(10)));
    if (missing.length > 0) return { kind: "attempts-not-in-build", missing };
    return {
      kind: "observations",
      lineage,
      // 요청 순서를 그대로 돌려준다. 소비자가 자기 목록과 응답을 좌표로 다시 맞추지 않아도 된다.
      attempts: query.attempts.map((attempt) =>
        attemptRecord(attempt, grouped.get(attempt.attemptId.toString(10))!)),
    };
  }
}
