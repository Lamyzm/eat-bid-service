from __future__ import annotations

from contextlib import nullcontext
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest

from eatbid.core.models import ProjectResult
from eatbid.core.repository import PublishedProjectionEvidence
from eatbid.foundation import FoundationServices, run_foundation_slice
from eatbid.foundation_repository import (
    FoundationCheckpoint,
    FoundationIntegrityError,
    FoundationNormalizationCheckpoint,
    FoundationObservationCheckpoint,
    FoundationPublicationCheckpoint,
    FoundationPublishedEvidence,
    FoundationRequestCheckpoint,
)
from eatbid.ingest.publication_repository import PublicationValidation
from eatbid.ingest.repository import request_params_sha256

RUN_ID = UUID("13000000-0000-0000-0000-000000000101")
PUBLICATION_ID = UUID("13000000-0000-0000-0000-000000000102")
OTHER_ID = UUID("13000000-0000-0000-0000-000000000199")
BUILD_SHA = "d" * 64
STARTED_AT = datetime(2026, 8, 29, 4, 0, tzinfo=UTC)
PARAMS = {"ELCTRN_BID_ID": "unit-foundation"}


class FakeCheckpointRepository:
    def __init__(self, checkpoint: FoundationCheckpoint) -> None:
        self.checkpoint = checkpoint
        self.loads = 0

    def run_lock(self, **_: object):
        return nullcontext()

    def start_or_load(self, **_: object) -> FoundationCheckpoint:
        return self.checkpoint

    def load(self, **_: object) -> FoundationCheckpoint:
        self.loads += 1
        return self.checkpoint


class FakePublicationRepository:
    def __init__(self, result: object) -> None:
        self.result = result

    def validate_run(self, **_: object) -> object:
        return self.result


class SpyProjectionRepository:
    def __init__(
        self,
        result: object | None = None,
        *,
        published_evidence: object | None = None,
    ) -> None:
        self.result = result
        self.published_evidence = published_evidence
        self.calls = 0

    def project_publication(self, **_: object) -> object:
        self.calls += 1
        return self.result

    def verify_published_publication(self, **_: object) -> object:
        self.calls += 1
        return self.published_evidence


def _checkpoint(*, status: str = "running") -> FoundationCheckpoint:
    normalized = FoundationNormalizationCheckpoint(
        normalization_attempt_id=21,
        observation_id=11,
        parser_version="eat-v1",
        status="normalized",
        normalized_record_id=31,
        record_type="auction",
        source_entity_id="unit-foundation",
        canonical_payload=b"{}",
        schema_fingerprint="a" * 64,
        quarantine_reason=None,
    )
    publication_status = "validated" if status == "validated" else "pending"
    members = (31,) if status == "validated" else ()
    return FoundationCheckpoint(
        run_id=RUN_ID,
        mode="poll-open",
        status=status,
        build_sha=BUILD_SHA,
        parser_version="eat-v1",
        started_at=STARTED_AT,
        expected_count=1,
        captured_count=1,
        published_count=0,
        failure_category=None,
        ended_at=None,
        request=FoundationRequestCheckpoint(
            request_unit_id=1,
            run_id=RUN_ID,
            source="eat",
            endpoint="bid-detail",
            params=PARAMS,
            request_params_hash=request_params_sha256(PARAMS),
            expected_count=1,
            observed_count=1,
            status="captured",
        ),
        observation=FoundationObservationCheckpoint(
            observation_id=11,
            run_id=RUN_ID,
            request_unit_id=1,
            source="eat",
            endpoint="bid-detail",
            params=PARAMS,
            fetched_at=STARTED_AT,
            http_status=200,
            content_sha256="c" * 64,
            object_key="raw/eat/bid-detail/" + "c" * 64 + ".xml.gz",
            byte_length=10,
        ),
        normalization=normalized,
        publication=FoundationPublicationCheckpoint(
            publication_id=PUBLICATION_ID,
            run_id=RUN_ID,
            status=publication_status,
            expected_count=1,
            normalized_count=1 if status == "validated" else 0,
            published_count=0,
            member_ids=members,
            canonical_fingerprint=None,
            projector_version=None,
        ),
        evidence=None,
    )


def _published_checkpoint() -> FoundationCheckpoint:
    checkpoint = _checkpoint(status="validated")
    return replace(
        checkpoint,
        status="published",
        published_count=1,
        ended_at=STARTED_AT + timedelta(minutes=3),
        publication=replace(
            checkpoint.publication,
            status="published",
            published_count=1,
            canonical_fingerprint="e" * 64,
            projector_version=BUILD_SHA,
        ),
        evidence=FoundationPublishedEvidence(
            capture_run_id=RUN_ID,
            publication_id=PUBLICATION_ID,
            request_unit_id=1,
            observation_ids=(11,),
            raw_content_sha256="c" * 64,
            raw_object_key="raw/eat/bid-detail/" + "c" * 64 + ".xml.gz",
            raw_blob_count=1,
            observation_count=1,
            publication_status="published",
        ),
    )


def _run(
    checkpoint: FoundationCheckpoint,
    *,
    validation: object | None = None,
    projector: SpyProjectionRepository,
    expected_count: int = 1,
) -> None:
    run_foundation_slice(
        run_id=RUN_ID,
        publication_id=PUBLICATION_ID,
        mode="poll-open",
        build_sha=BUILD_SHA,
        parser_version="eat-v1",
        started_at=STARTED_AT,
        normalized_at=STARTED_AT + timedelta(minutes=1),
        validated_at=STARTED_AT + timedelta(minutes=2),
        activated_at=STARTED_AT + timedelta(minutes=3),
        source="eat",
        endpoint="bid-detail",
        request_params=PARAMS,
        expected_count=expected_count,
        services=FoundationServices(
            checkpoint_repository=FakeCheckpointRepository(checkpoint),
            ingest_repository=object(),
            normalization_repository=object(),
            publication_repository=FakePublicationRepository(validation),
            projection_repository=projector,
            raw_store=object(),
            source_client=object(),
        ),
    )


@pytest.mark.parametrize(
    "mutate",
    [
        lambda value: replace(value, run_id=OTHER_ID),
        lambda value: replace(
            value, publication=replace(value.publication, status="pending")
        ),
        lambda value: replace(value, request=replace(value.request, status="planned")),
    ],
)
def test_foundation_rejects_malicious_checkpoint_before_projection(mutate) -> None:
    checkpoint = mutate(_checkpoint(status="validated"))
    projector = SpyProjectionRepository()
    with pytest.raises(FoundationIntegrityError):
        _run(checkpoint, projector=projector)
    assert projector.calls == 0


@pytest.mark.parametrize(
    "validation",
    [
        PublicationValidation(OTHER_ID, RUN_ID, "validated", 1, 1, (31,)),
        PublicationValidation(PUBLICATION_ID, OTHER_ID, "validated", 1, 1, (31,)),
        PublicationValidation(PUBLICATION_ID, RUN_ID, "unknown", 1, 1, (31,)),
        PublicationValidation(PUBLICATION_ID, RUN_ID, "validated", True, 1, (31,)),
        PublicationValidation(PUBLICATION_ID, RUN_ID, "validated", 1, -1, (31,)),
        PublicationValidation(PUBLICATION_ID, RUN_ID, "validated", 1, 1, (99,)),
        object(),
    ],
)
def test_foundation_rejects_malicious_validation_before_projection(
    validation: object,
) -> None:
    projector = SpyProjectionRepository()
    with pytest.raises(FoundationIntegrityError):
        _run(_checkpoint(), validation=validation, projector=projector)
    assert projector.calls == 0


@pytest.mark.parametrize(
    "project",
    [
        ProjectResult(OTHER_ID, 1, 1, 1, 1, 1, 1, 1, "b" * 64),
        ProjectResult(PUBLICATION_ID, 0, 1, 1, 1, 1, 1, 1, "b" * 64),
        ProjectResult(PUBLICATION_ID, 1, True, 1, 1, 1, 1, 1, "b" * 64),
        ProjectResult(PUBLICATION_ID, 1, 1, 1, -1, 1, 1, 1, "b" * 64),
        ProjectResult(PUBLICATION_ID, 1, 1, 1, 1, 1, 1, 1, "not-a-hash"),
        object(),
    ],
)
def test_foundation_rejects_malicious_project_result(project: object) -> None:
    projector = SpyProjectionRepository(project)
    with pytest.raises(FoundationIntegrityError):
        _run(_checkpoint(status="validated"), projector=projector)


def test_published_reentry_rejects_forged_empty_topology_and_evidence() -> None:
    checkpoint = _checkpoint(status="validated")
    forged = replace(
        checkpoint,
        status="published",
        normalization=None,
        published_count=0,
        ended_at=STARTED_AT,
        publication=replace(
            checkpoint.publication,
            status="published",
            normalized_count=1,
            published_count=1,
            member_ids=(),
            canonical_fingerprint="e" * 64,
            projector_version="wrong-projector",
        ),
        evidence=FoundationPublishedEvidence(
            capture_run_id=RUN_ID,
            publication_id=PUBLICATION_ID,
            request_unit_id=1,
            observation_ids=(11,),
            raw_content_sha256="c" * 64,
            raw_object_key="raw/eat/bid-detail/" + "c" * 64 + ".xml.gz",
            raw_blob_count=99,
            observation_count=88,
            publication_status="published",
        ),
    )
    projector = SpyProjectionRepository()

    with pytest.raises(FoundationIntegrityError):
        _run(forged, projector=projector)

    assert projector.calls == 0


@pytest.mark.parametrize(
    "published_evidence",
    [
        PublishedProjectionEvidence(OTHER_ID, 1, 1, 1, 1, "e" * 64),
        PublishedProjectionEvidence(PUBLICATION_ID, 0, 1, 1, 1, "e" * 64),
        PublishedProjectionEvidence(PUBLICATION_ID, 1, True, 1, 1, "e" * 64),
        PublishedProjectionEvidence(PUBLICATION_ID, 1, 2, 1, 1, "e" * 64),
        PublishedProjectionEvidence(PUBLICATION_ID, 1, 1, 1, 1, "f" * 64),
        object(),
    ],
)
def test_published_reentry_rejects_malicious_verified_projection_evidence(
    published_evidence: object,
) -> None:
    projector = SpyProjectionRepository(published_evidence=published_evidence)

    with pytest.raises(FoundationIntegrityError):
        _run(_published_checkpoint(), projector=projector)

    assert projector.calls == 1


def test_published_reentry_rejects_zero_ledger_counts_with_one_frozen_member(
) -> None:
    checkpoint = _published_checkpoint()
    forged = replace(
        checkpoint,
        expected_count=0,
        published_count=0,
        request=replace(checkpoint.request, expected_count=0),
        publication=replace(
            checkpoint.publication,
            expected_count=0,
            normalized_count=0,
            published_count=0,
        ),
    )
    projector = SpyProjectionRepository(
        published_evidence=PublishedProjectionEvidence(
            PUBLICATION_ID, 1, 1, 1, 1, "e" * 64
        )
    )

    with pytest.raises(FoundationIntegrityError):
        _run(forged, projector=projector, expected_count=0)


@pytest.mark.parametrize(
    ("frozen_expected_count", "terminal_count", "checkpoint_published_count"),
    [(2, 2, 2), (1, True, 1)],
    ids=("over-count", "boolean-count"),
)
def test_published_reentry_rejects_nonexact_terminal_cardinality(
    frozen_expected_count: int,
    terminal_count: int,
    checkpoint_published_count: int,
) -> None:
    checkpoint = _published_checkpoint()
    forged = replace(
        checkpoint,
        expected_count=frozen_expected_count,
        published_count=checkpoint_published_count,
        request=replace(checkpoint.request, expected_count=terminal_count),
        publication=replace(
            checkpoint.publication,
            expected_count=terminal_count,
            normalized_count=terminal_count,
            published_count=terminal_count,
        ),
    )
    projector = SpyProjectionRepository(
        published_evidence=PublishedProjectionEvidence(
            PUBLICATION_ID, 1, 1, 1, 1, "e" * 64
        )
    )

    with pytest.raises(FoundationIntegrityError):
        _run(
            forged,
            projector=projector,
            expected_count=frozen_expected_count,
        )
