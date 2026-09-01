from __future__ import annotations

from dataclasses import asdict
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from uuid import UUID

import pytest
from pydantic import TypeAdapter, ValidationError

from eatbid.ingest.release_models import ReleaseDatasetPlan, SourceReleasePlan
from eatbid.ingest.release_repository import (
    canonical_release_manifest,
    release_manifest_sha256,
)

RELEASE_ID = UUID("17000000-0000-0000-0000-000000000001")
AS_OF = datetime(2026, 9, 1, 12, tzinfo=timezone(timedelta(hours=9)))


def _dataset(dataset: str, fingerprint: str) -> ReleaseDatasetPlan:
    return ReleaseDatasetPlan(
        endpoint="bid-list",
        dataset=dataset,
        record_type="auction",
        parser_version="eat-v1",
        schema_fingerprint=fingerprint,
        expected_count=1,
        observed_count=1,
        normalized_count=1,
        quarantined_count=0,
        required=True,
    )


def _plan(*datasets: ReleaseDatasetPlan) -> SourceReleasePlan:
    return SourceReleasePlan(
        source_release_id=RELEASE_ID,
        source="eat",
        release_name="2026-09-01 정오",
        as_of=AS_OF,
        datasets=datasets,
    )


def test_manifest는_정렬된_dataset과_observation의_정확한_UTF8_bytes다() -> None:
    expected = (
        b'{"as_of":"2026-09-01T03:00:00.000000Z","datasets":'
        b'[{"dataset":"auction","endpoint":"bid-list","expected_count":1,'
        b'"normalized_count":1,"observed_count":1,"parser_version":"eat-v1",'
        b'"quarantined_count":0,"record_type":"auction","required":true,'
        b'"schema_fingerprint":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}],'
        b'"observations":[{"content_sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",'
        b'"observation_id":7}],"source":"eat"}'
    )
    plan = _plan(_dataset("auction", "a" * 64))

    rendered = canonical_release_manifest(plan, ((7, "b" * 64),))

    assert rendered == expected
    assert release_manifest_sha256(plan, ((7, "b" * 64),)) == sha256(
        expected
    ).hexdigest()


def test_manifest는_member_입력_순서가_달라도_같다() -> None:
    auction = _dataset("auction", "a" * 64)
    supplier = _dataset("supplier", "c" * 64)
    observations = ((8, "d" * 64), (7, "b" * 64))

    forward = canonical_release_manifest(
        _plan(auction, supplier), observations
    )
    reverse = canonical_release_manifest(
        _plan(supplier, auction), tuple(reversed(observations))
    )

    assert reverse == forward


def test_release_plan은_중복_dataset을_조용히_덮어쓰지_않는다() -> None:
    duplicate = _dataset("auction", "a" * 64)

    with pytest.raises(ValidationError, match="unique"):
        _plan(duplicate, duplicate)


def test_manifest는_중복_observation을_조용히_덮어쓰지_않는다() -> None:
    plan = _plan(_dataset("auction", "a" * 64))

    with pytest.raises(ValueError, match="unique"):
        canonical_release_manifest(plan, ((7, "b" * 64), (7, "b" * 64)))


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("expected_count", True),
        ("observed_count", -1),
        ("normalized_count", True),
        ("quarantined_count", -1),
    ],
)
def test_dataset_count는_bool과_음수를_거부한다(field: str, value: object) -> None:
    values = asdict(_dataset("auction", "a" * 64))
    values[field] = value

    with pytest.raises(ValidationError):
        TypeAdapter(ReleaseDatasetPlan).validate_python(values)


def test_release_plan은_naive_as_of를_거부한다() -> None:
    with pytest.raises(ValidationError, match="timezone-aware"):
        SourceReleasePlan(
            source_release_id=RELEASE_ID,
            source="eat",
            release_name="naive 시각",
            as_of=datetime(2026, 9, 1, 3),  # noqa: DTZ001 - naive 입력 거부를 검증한다.
            datasets=(_dataset("auction", "a" * 64),),
        )
