from __future__ import annotations

import json
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


def _canonical_auction_payload(*, external_bid_id: str = "unit-foundation") -> bytes:
    return json.dumps(
        {
            "buyer": {
                "organizationCode": "UNIT-ORG",
                "organizationName": "Unit organization",
            },
            "classification": {
                "categorySource": "unknown",
                "sourceCategoryLabel": None,
            },
            "contractVersion": "eatbid.ingestion.auction.v1",
            "identity": {
                "displayBidNumber": None,
                "externalBidId": external_bid_id,
                "status": "OPEN",
                "title": "Unit foundation auction",
            },
            "location": {
                "eligibilityCodes": [],
                "sidoCode": None,
                "sigunguCode": None,
            },
            "pricing": {"baseAmount": None, "plannedAmount": None},
            "schedule": {
                "announcedAt": None,
                "deadlineAt": None,
                "openedAt": None,
            },
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


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
        record_type="auction.v1",
        source_entity_id="unit-foundation",
        canonical_payload=_canonical_auction_payload(),
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


def _failed_checkpoint() -> FoundationCheckpoint:
    checkpoint = _checkpoint()
    return replace(
        checkpoint,
        status="failed",
        captured_count=0,
        failure_category="SOURCE_CONTRACT",
        ended_at=STARTED_AT + timedelta(minutes=3),
        request=replace(
            checkpoint.request,
            observed_count=0,
            status="failed",
        ),
        observation=None,
        normalization=None,
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
def test_foundation가_malicious_checkpoint_전에_projection을_거부한다(mutate) -> None:
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
def test_foundation가_malicious_validation_전에_projection을_거부한다(
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
def test_foundation가_malicious_project_result을_거부한다(project: object) -> None:
    projector = SpyProjectionRepository(project)
    with pytest.raises(FoundationIntegrityError):
        _run(_checkpoint(status="validated"), projector=projector)


def test_발행된_reentry가_forged_empty_topology와_evidence를_거부한다() -> None:
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
def test_발행된_reentry가_malicious_verified_projection_evidence을_거부한다(
    published_evidence: object,
) -> None:
    projector = SpyProjectionRepository(published_evidence=published_evidence)

    with pytest.raises(FoundationIntegrityError):
        _run(_published_checkpoint(), projector=projector)

    assert projector.calls == 1


def test_발행된_reentry가_frozen_member_하나와_zero_ledger_count를_거부한다(
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
def test_발행된_reentry가_nonexact_terminal_cardinality을_거부한다(
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


def _terminal_checkpoint(state: str) -> FoundationCheckpoint:
    return (
        _checkpoint(status="validated")
        if state == "validated"
        else _published_checkpoint()
    )


def _assert_rejected_before_projection(checkpoint: FoundationCheckpoint) -> None:
    projector = SpyProjectionRepository(
        published_evidence=PublishedProjectionEvidence(
            PUBLICATION_ID, 1, 1, 1, 1, "e" * 64
        )
    )

    with pytest.raises(FoundationIntegrityError):
        _run(checkpoint, projector=projector)

    assert projector.calls == 0


@pytest.mark.parametrize("state", ["validated", "published"])
@pytest.mark.parametrize(
    ("field", "invalid"),
    [
        ("status", "quarantined"),
        ("observation_id", 12),
        ("parser_version", "eat-v2"),
        ("normalization_attempt_id", True),
        ("normalization_attempt_id", 0),
    ],
)
def test_terminal_checkpoint가_normalization_field_drift_전에_projection을_거부한다(
    state: str,
    field: str,
    invalid: object,
) -> None:
    checkpoint = _terminal_checkpoint(state)
    assert checkpoint.normalization is not None
    malformed = replace(
        checkpoint,
        normalization=replace(checkpoint.normalization, **{field: invalid}),
    )

    _assert_rejected_before_projection(malformed)


@pytest.mark.parametrize("state", ["validated", "published"])
@pytest.mark.parametrize("invalid_id", [True, 0])
def test_terminal_checkpoint가_유효하지_않은_normalized_member_id을_거부한다(
    state: str,
    invalid_id: object,
) -> None:
    checkpoint = _terminal_checkpoint(state)
    assert checkpoint.normalization is not None
    malformed = replace(
        checkpoint,
        normalization=replace(
            checkpoint.normalization,
            normalized_record_id=invalid_id,
        ),
        publication=replace(checkpoint.publication, member_ids=(invalid_id,)),
    )

    _assert_rejected_before_projection(malformed)


@pytest.mark.parametrize("state", ["validated", "published"])
def test_terminal_checkpoint가_untyped_normalization을_거부한다(state: str) -> None:
    _assert_rejected_before_projection(
        replace(_terminal_checkpoint(state), normalization=object())
    )


def test_validated_checkpoint가_boolean_nested_counts_전에_projection을_거부한다(
) -> None:
    checkpoint = _checkpoint(status="validated")
    malformed = replace(
        checkpoint,
        request=replace(checkpoint.request, expected_count=True),
        publication=replace(
            checkpoint.publication,
            expected_count=True,
            normalized_count=True,
        ),
    )

    _assert_rejected_before_projection(malformed)


def _checkpoint_for_state(state: str) -> FoundationCheckpoint:
    if state == "published":
        return _published_checkpoint()
    if state == "failed":
        return _failed_checkpoint()
    return _checkpoint(status=state)


@pytest.mark.parametrize("state", ["running", "validated", "published", "failed"])
@pytest.mark.parametrize(
    ("field", "invalid"),
    [
        ("request", object()),
        ("publication", object()),
        ("observation", object()),
    ],
)
def test_checkpoint는_raw_error가_없어도_untyped_nested_companion을_거부한다(
    state: str,
    field: str,
    invalid: object,
) -> None:
    _assert_rejected_before_projection(
        replace(_checkpoint_for_state(state), **{field: invalid})
    )


@pytest.mark.parametrize("state", ["running", "validated", "published", "failed"])
@pytest.mark.parametrize("field", ["normalization", "evidence"])
def test_checkpoint가_port_호출_전에_untyped_optional_companion을_거부한다(
    state: str,
    field: str,
) -> None:
    _assert_rejected_before_projection(
        replace(_checkpoint_for_state(state), **{field: object()})
    )


@pytest.mark.parametrize(
    "invalid_params",
    [
        object(),
        {1: "unit-foundation"},
        {"ELCTRN_BID_ID": object()},
    ],
    ids=("not-a-mapping", "non-string-key", "non-string-value"),
)
@pytest.mark.parametrize("owner", ["request", "observation"])
def test_checkpoint는_raw_error가_없어도_malformed_nested_parameter를_거부한다(
    invalid_params: object,
    owner: str,
) -> None:
    checkpoint = _checkpoint(status="validated")
    nested = replace(getattr(checkpoint, owner), params=invalid_params)
    _assert_rejected_before_projection(replace(checkpoint, **{owner: nested}))


@pytest.mark.parametrize("state", ["validated", "published"])
@pytest.mark.parametrize(
    ("field", "invalid"),
    [
        ("record_type", None),
        ("record_type", "organization"),
        ("record_type", True),
        ("source_entity_id", None),
        ("source_entity_id", ""),
        ("source_entity_id", " unit-foundation "),
        ("source_entity_id", True),
        ("canonical_payload", None),
        ("canonical_payload", b""),
        ("canonical_payload", "not-bytes"),
        ("canonical_payload", b"{}"),
        (
            "canonical_payload",
            json.dumps(
                json.loads(_canonical_auction_payload()),
                ensure_ascii=False,
            ).encode("utf-8"),
        ),
        ("canonical_payload", _canonical_auction_payload(external_bid_id="other")),
        ("schema_fingerprint", None),
        ("schema_fingerprint", "A" * 64),
        ("schema_fingerprint", True),
        ("quarantine_reason", "unexpected quarantine"),
        ("quarantine_reason", object()),
    ],
    ids=(
        "missing-record-type",
        "wrong-record-type",
        "boolean-record-type",
        "missing-source-entity",
        "empty-source-entity",
        "untrimmed-source-entity",
        "boolean-source-entity",
        "missing-payload",
        "empty-payload",
        "non-bytes-payload",
        "wrong-model-payload",
        "noncanonical-payload",
        "payload-external-id-drift",
        "missing-schema-fingerprint",
        "uppercase-schema-fingerprint",
        "boolean-schema-fingerprint",
        "quarantine-reason",
        "object-quarantine-reason",
    ),
)
def test_terminal_checkpoint가_incomplete_normalized_auction_contract을_거부한다(
    state: str,
    field: str,
    invalid: object,
) -> None:
    checkpoint = _terminal_checkpoint(state)
    assert checkpoint.normalization is not None
    _assert_rejected_before_projection(
        replace(
            checkpoint,
            normalization=replace(
                checkpoint.normalization,
                **{field: invalid},
            ),
        )
    )


@pytest.mark.parametrize("state", ["validated", "published"])
@pytest.mark.parametrize(
    ("owner", "field", "invalid"),
    [
        ("observation", "fetched_at", object()),
        ("observation", "http_status", True),
        ("observation", "byte_length", True),
        ("observation", "content_sha256", True),
        ("observation", "object_key", object()),
        ("publication", "member_ids", object()),
        ("checkpoint", "ended_at", object()),
    ],
)
def test_terminal_checkpoint가_port_호출_전에_malformed_trusted_scalar_field를_거부한다(
    state: str,
    owner: str,
    field: str,
    invalid: object,
) -> None:
    checkpoint = _terminal_checkpoint(state)
    malformed = (
        replace(checkpoint, **{field: invalid})
        if owner == "checkpoint"
        else replace(
            checkpoint,
            **{owner: replace(getattr(checkpoint, owner), **{field: invalid})},
        )
    )
    _assert_rejected_before_projection(malformed)


@pytest.mark.parametrize(
    ("field", "invalid"),
    [
        ("request_unit_id", True),
        ("observation_ids", (True,)),
        ("observation_ids", [11]),
    ],
)
def test_발행된_checkpoint가_verifier_호출_전에_malformed_evidence_identity를_거부한다(
    field: str,
    invalid: object,
) -> None:
    checkpoint = _published_checkpoint()
    assert checkpoint.evidence is not None
    _assert_rejected_before_projection(
        replace(
            checkpoint,
            evidence=replace(checkpoint.evidence, **{field: invalid}),
        )
    )
