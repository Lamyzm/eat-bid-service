"""모듈 책임: capture·normalize·validate·project 단계 결과와 발행 증거·정규화 lineage가 checkpoint와 어긋나지 않는지 판독한다."""

from __future__ import annotations

from uuid import UUID

from eatbid.core.models import ProjectResult
from eatbid.core.record_types import is_projectable_record_type
from eatbid.core.repository import (
    CanonicalProjectionRepository,
    ProjectionContractError,
    PublishedProjectionEvidence,
)
from eatbid.foundation_repository import (
    FoundationCheckpoint,
    FoundationIntegrityError,
    FoundationNormalizationCheckpoint,
    FoundationPublishedEvidence,
)
from eatbid.foundation_values import _nonnegative_int, _positive_int, _sha256
from eatbid.generated.ingestion_v2 import EatbidIngestionAuctionV2
from eatbid.ingest.models import CapturedObservation
from eatbid.ingest.normalization_repository import StoredNormalizedRecord
from eatbid.ingest.publication_repository import PublicationValidation
from eatbid.pipeline.project import (
    parse_canonical_normalized_record,
    verify_published_publication,
)


def _verify_capture_result(result: object) -> None:
    if not isinstance(result, CapturedObservation):
        raise FoundationIntegrityError("capture port returned an unsupported result")
    _positive_int(result.observation_id, "capture observation_id")
    _sha256(result.content_sha256, "capture content_sha256")


def _verify_normalization_result(
    result: object,
    *,
    run_id: UUID,
    observation_id: int,
    parser_version: str,
) -> None:
    if not isinstance(result, StoredNormalizedRecord):
        raise FoundationIntegrityError("normalizer returned an unsupported result")
    if (
        result.run_id != run_id
        or result.observation_id != observation_id
        or result.parser_version != parser_version
    ):
        raise FoundationIntegrityError("normalization result differs from request")
    _positive_int(result.normalization_attempt_id, "normalization_attempt_id")
    _positive_int(result.normalized_record_id, "normalized_record_id")
    _sha256(result.schema_fingerprint, "schema_fingerprint")


def _verify_validation_result(
    result: object, *, checkpoint: FoundationCheckpoint
) -> None:
    if not isinstance(result, PublicationValidation):
        raise FoundationIntegrityError("validator returned an unsupported result")
    if result.status not in {"validated", "failed"}:
        raise FoundationIntegrityError("validator returned an unsupported status")
    _nonnegative_int(result.expected_count, "validation expected_count")
    _nonnegative_int(result.normalized_count, "validation normalized_count")
    normalization = checkpoint.normalization
    normalized_id = (
        normalization.normalized_record_id if normalization is not None else None
    )
    normalized_count = int(normalized_id is not None)
    members = (
        (normalized_id,)
        if result.status == "validated" and normalized_id is not None
        else ()
    )
    if (
        result.run_id != checkpoint.run_id
        or result.publication_id != checkpoint.publication.publication_id
        or result.expected_count != checkpoint.expected_count
        or result.normalized_count != normalized_count
        or result.member_ids != members
    ):
        raise FoundationIntegrityError("validator result differs from checkpoint")


def _verify_project_result(result: object, *, checkpoint: FoundationCheckpoint) -> None:
    if not isinstance(result, ProjectResult):
        raise FoundationIntegrityError("projector returned an unsupported result")
    counts = (
        result.members_projected,
        result.auction_attempts_inserted,
        result.auction_revisions_inserted,
        result.organizations_inserted,
        result.code_values_inserted,
        result.code_labels_inserted,
        result.relationships_inserted,
    )
    for count in counts:
        _nonnegative_int(count, "project count")
    if (
        result.publication_id != checkpoint.publication.publication_id
        or result.members_projected != len(checkpoint.publication.member_ids)
    ):
        raise FoundationIntegrityError("projector result differs from publication")
    _sha256(result.canonical_fingerprint, "project canonical_fingerprint")


def _verify_evidence(
    evidence: FoundationPublishedEvidence | None,
    *,
    checkpoint: FoundationCheckpoint,
) -> None:
    if not isinstance(evidence, FoundationPublishedEvidence):
        raise FoundationIntegrityError("published checkpoint lacks typed evidence")
    _positive_int(evidence.request_unit_id, "evidence request_unit_id")
    if not isinstance(evidence.observation_ids, tuple):
        raise FoundationIntegrityError("evidence observation_ids must be a tuple")
    for observation_id in evidence.observation_ids:
        _positive_int(observation_id, "evidence observation_id")
    if (
        evidence.capture_run_id != checkpoint.run_id
        or evidence.publication_id != checkpoint.publication.publication_id
        or evidence.request_unit_id != checkpoint.request.request_unit_id
        or checkpoint.observation is None
        or evidence.observation_ids != (checkpoint.observation.observation_id,)
        or evidence.raw_content_sha256 != checkpoint.observation.content_sha256
        or evidence.raw_object_key != checkpoint.observation.object_key
        or evidence.publication_status != checkpoint.publication.status
        or evidence.raw_blob_count != 1
        or evidence.observation_count != 1
    ):
        raise FoundationIntegrityError("published evidence differs from checkpoint")
    _nonnegative_int(evidence.raw_blob_count, "evidence raw_blob_count")
    _nonnegative_int(evidence.observation_count, "evidence observation_count")
    _sha256(evidence.raw_content_sha256, "evidence raw_content_sha256")


def _load_verified_projection_evidence(
    *,
    checkpoint: FoundationCheckpoint,
    projector_version: str,
    repository: CanonicalProjectionRepository,
) -> PublishedProjectionEvidence:
    try:
        evidence = verify_published_publication(
            publication_id=checkpoint.publication.publication_id,
            projector_version=projector_version,
            repository=repository,
        )
    except ProjectionContractError as error:
        raise FoundationIntegrityError(
            "published canonical evidence failed verification"
        ) from error
    if not isinstance(evidence, PublishedProjectionEvidence):
        raise FoundationIntegrityError(
            "projection repository returned unsupported published evidence"
        )
    counts = (
        evidence.members_projected,
        evidence.organization_count,
        evidence.auction_attempt_count,
        evidence.auction_revision_count,
    )
    for count in counts:
        _nonnegative_int(count, "published projection count")
    _verify_member_cardinality(
        checkpoint,
        verified_members_projected=evidence.members_projected,
    )
    member_count = len(checkpoint.publication.member_ids)
    if (
        evidence.publication_id != checkpoint.publication.publication_id
        or evidence.organization_count != member_count
        or evidence.auction_attempt_count != member_count
        or evidence.auction_revision_count != member_count
        or evidence.canonical_fingerprint
        != checkpoint.publication.canonical_fingerprint
    ):
        raise FoundationIntegrityError(
            "published projection evidence differs from checkpoint"
        )
    _sha256(evidence.canonical_fingerprint, "published canonical_fingerprint")
    _verify_published_roster(checkpoint, evidence)
    return evidence


def _verify_published_roster(
    checkpoint: FoundationCheckpoint, evidence: PublishedProjectionEvidence
) -> None:
    """봉인된 관측이 담은 명단 행 수·낙찰 판정 수가 core에 그대로 남았는지 종단에서 다시 센다.

    projector 안에서 이미 검증했는데 왜 또 세나. "검증을 통과했다"와 "발행이 끝난 뒤 실제로 그만큼
    남아 있다"는 서로 다른 주장이고, 종단 검사가 확인해야 하는 것은 뒤쪽이다. v1 발행은 계약에 명단이
    없으므로 둘 다 0이어야 한다.
    """
    for count in (evidence.bid_submission_count, evidence.award_decision_count):
        _nonnegative_int(count, "published roster count")
    normalization = checkpoint.normalization
    if normalization is None or normalization.record_type is None:
        raise FoundationIntegrityError("published checkpoint lacks typed normalization")
    record = parse_canonical_normalized_record(
        normalization.record_type, normalization.canonical_payload
    )
    expected_rows = (
        len(record.roster.submissions)
        if isinstance(record, EatbidIngestionAuctionV2)
        else 0
    )
    expected_awards = (
        int(record.award is not None)
        if isinstance(record, EatbidIngestionAuctionV2)
        else 0
    )
    if (
        evidence.bid_submission_count != expected_rows
        or evidence.award_decision_count != expected_awards
    ):
        raise FoundationIntegrityError(
            "published roster differs from the frozen observation"
        )


def _verify_normalization_lineage(checkpoint: FoundationCheckpoint) -> None:
    normalization = checkpoint.normalization
    observation = checkpoint.observation
    if not isinstance(normalization, FoundationNormalizationCheckpoint):
        raise FoundationIntegrityError(
            "terminal checkpoint lacks typed normalization"
        )
    if observation is None:
        raise FoundationIntegrityError(
            "terminal normalization lacks its observation"
        )
    _verify_normalized_auction_contract(normalization)
    member_ids = checkpoint.publication.member_ids
    if not isinstance(member_ids, tuple) or len(member_ids) != 1:
        raise FoundationIntegrityError(
            "terminal publication must contain one typed member"
        )
    _positive_int(member_ids[0], "publication member_id")
    if (
        normalization.status != "normalized"
        or normalization.observation_id != observation.observation_id
        or normalization.parser_version != checkpoint.parser_version
        or normalization.normalized_record_id != member_ids[0]
    ):
        raise FoundationIntegrityError(
            "terminal normalization lineage differs from its checkpoint"
        )
    _verify_member_cardinality(checkpoint)


def _verify_normalized_auction_contract(
    normalization: FoundationNormalizationCheckpoint,
) -> None:
    record_type = normalization.record_type
    if record_type is None or not is_projectable_record_type(record_type):
        raise FoundationIntegrityError(
            "terminal normalization record_type must be projectable "
            f"[record_type={record_type}]"
        )
    source_entity_id = normalization.source_entity_id
    if (
        not isinstance(source_entity_id, str)
        or not source_entity_id
        or source_entity_id.strip() != source_entity_id
    ):
        raise FoundationIntegrityError(
            "terminal normalization source_entity_id must be a trimmed string"
        )
    try:
        record = parse_canonical_normalized_record(
            record_type, normalization.canonical_payload
        )
    except ProjectionContractError as error:
        raise FoundationIntegrityError(
            "terminal normalization canonical payload is invalid"
        ) from error
    if record.identity.external_bid_id != source_entity_id:
        raise FoundationIntegrityError(
            "terminal normalization external ID differs from source entity"
        )
    _sha256(normalization.schema_fingerprint, "schema_fingerprint")
    if normalization.quarantine_reason is not None:
        raise FoundationIntegrityError(
            "normalized terminal checkpoint cannot be quarantined"
        )


def _verify_member_cardinality(
    checkpoint: FoundationCheckpoint,
    *,
    verified_members_projected: object | None = None,
) -> None:
    publication = checkpoint.publication
    counts: tuple[object, ...] = (
        checkpoint.expected_count,
        checkpoint.captured_count,
        checkpoint.request.expected_count,
        checkpoint.request.observed_count,
        publication.expected_count,
        publication.normalized_count,
        len(publication.member_ids),
    )
    if verified_members_projected is not None:
        counts += (verified_members_projected,)
    for count in counts:
        _nonnegative_int(count, "terminal member cardinality")
    if counts[0] != 1 or any(count != counts[0] for count in counts[1:]):
        raise FoundationIntegrityError(
            "terminal cardinality differs from the one frozen detail member"
        )
    published_count = int(checkpoint.status == "published")
    _nonnegative_int(checkpoint.published_count, "run published_count")
    _nonnegative_int(publication.published_count, "publication published_count")
    if (
        checkpoint.published_count != published_count
        or publication.published_count != published_count
    ):
        raise FoundationIntegrityError(
            "terminal published counts differ from checkpoint status"
        )
