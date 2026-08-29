import gzip
from collections.abc import Callable
from datetime import UTC, datetime

import pytest
from botocore.exceptions import ClientError
from eatbid.object_store import build_raw_object_key, deterministic_gzip
from eatbid.r2_store import (
    ObjectCollisionError,
    ObjectCorruptionError,
    R2RawObjectStore,
    R2Settings,
)
from fakes import FakeS3Object, StatefulFakeS3Client, client_error
from pydantic import ValidationError


def settings() -> R2Settings:
    return R2Settings(
        R2_ENDPOINT_URL="https://account.r2.cloudflarestorage.com",
        R2_BUCKET="eatbid-raw",
        R2_ACCESS_KEY_ID="access-id",
        R2_SECRET_ACCESS_KEY="secret-key",
    )


def append_trailing_bytes_with_matching_length(obj: FakeS3Object) -> None:
    obj.body += b"junk"
    obj.content_length = len(obj.body)


def replace_with_noncanonical_valid_gzip(obj: FakeS3Object) -> None:
    obj.body = gzip.compress(b"raw", mtime=1)
    obj.content_length = len(obj.body)


def test_missing_object_is_created_with_deterministic_archive_contract() -> None:
    s3 = StatefulFakeS3Client()
    store = R2RawObjectStore(settings(), client=s3)
    body = b"<x>1</x>"

    stored = store.put(source="eat", endpoint="bid-list", body=body)

    assert stored.content_sha256 == (
        "a4753d7f1f568904517dcd1a4051192fe968de97095123e29756b6d645e7d6cf"
    )
    assert stored.byte_length == len(body)
    assert stored.stored_at.tzinfo is UTC
    assert s3.put_requests == [
        {
            "Bucket": "eatbid-raw",
            "Key": stored.object_key,
            "Body": deterministic_gzip(body),
            "ContentEncoding": "gzip",
            "ContentType": "application/xml",
            "Metadata": {
                "source-sha256": stored.content_sha256,
                "source-byte-length": str(len(body)),
            },
        }
    ]


def test_identical_existing_object_is_reused_with_original_timestamp() -> None:
    s3 = StatefulFakeS3Client()
    store = R2RawObjectStore(settings(), client=s3)
    first = store.put(source="eat", endpoint="bid-list", body=b"raw")
    original_timestamp = datetime(2025, 1, 2, 3, 4, 5, tzinfo=UTC)
    s3.objects[first.object_key].last_modified = original_timestamp

    second = store.put(source="eat", endpoint="bid-list", body=b"raw")

    assert second == first.__class__(
        first.content_sha256,
        first.object_key,
        first.byte_length,
        original_timestamp,
    )
    assert len(s3.put_requests) == 1


@pytest.mark.parametrize(
    "mutation",
    [
        lambda obj: obj.metadata.update({"source-sha256": "0" * 64}),
        lambda obj: obj.metadata.update({"source-byte-length": "999"}),
        lambda obj: setattr(obj, "content_length", obj.content_length + 1),
        lambda obj: setattr(obj, "content_encoding", "identity"),
        lambda obj: setattr(obj, "content_type", "text/plain"),
    ],
    ids=["hash", "raw-length", "compressed-length", "encoding", "content-type"],
)
def test_existing_object_contract_mismatch_is_a_collision(
    mutation: Callable[[FakeS3Object], None],
) -> None:
    s3 = StatefulFakeS3Client()
    store = R2RawObjectStore(settings(), client=s3)
    stored = store.put(source="eat", endpoint="bid-list", body=b"raw")
    mutation(s3.objects[stored.object_key])

    with pytest.raises(ObjectCollisionError):
        store.put(source="eat", endpoint="bid-list", body=b"raw")

    assert len(s3.put_requests) == 1


def test_only_explicit_not_found_is_treated_as_absent() -> None:
    s3 = StatefulFakeS3Client()
    s3.head_error = client_error("AccessDenied", "HeadObject", status=403)
    store = R2RawObjectStore(settings(), client=s3)

    with pytest.raises(ClientError):
        store.put(source="eat", endpoint="bid-list", body=b"raw")

    assert s3.put_requests == []


def test_read_round_trips_and_validates_the_stored_envelope() -> None:
    s3 = StatefulFakeS3Client()
    store = R2RawObjectStore(settings(), client=s3)
    stored = store.put(source="eat", endpoint="bid-list", body=b"\x00\xffraw")

    assert store.read(stored.object_key) == b"\x00\xffraw"


@pytest.mark.parametrize(
    "mutation",
    [
        lambda obj: obj.metadata.update({"source-sha256": "0" * 64}),
        lambda obj: obj.metadata.update({"source-byte-length": "999"}),
        lambda obj: setattr(obj, "content_length", obj.content_length + 1),
        lambda obj: setattr(obj, "content_encoding", "identity"),
        lambda obj: setattr(obj, "content_type", "text/plain"),
        lambda obj: setattr(obj, "body", obj.body + b"junk"),
        append_trailing_bytes_with_matching_length,
        replace_with_noncanonical_valid_gzip,
        lambda obj: setattr(obj, "body", b"not-gzip"),
    ],
    ids=[
        "hash-metadata",
        "raw-length",
        "declared-compressed-length",
        "encoding",
        "content-type",
        "compressed-body-length",
        "trailing-bytes",
        "noncanonical-gzip",
        "invalid-gzip",
    ],
)
def test_read_detects_corrupt_metadata_headers_or_body(
    mutation: Callable[[FakeS3Object], None],
) -> None:
    s3 = StatefulFakeS3Client()
    store = R2RawObjectStore(settings(), client=s3)
    stored = store.put(source="eat", endpoint="bid-list", body=b"raw")
    mutation(s3.objects[stored.object_key])

    with pytest.raises(ObjectCorruptionError):
        store.read(stored.object_key)


def test_invalid_put_slug_and_read_key_fail_before_s3_calls() -> None:
    s3 = StatefulFakeS3Client()
    store = R2RawObjectStore(settings(), client=s3)

    with pytest.raises(ValueError):
        store.put(source="../eat", endpoint="bid-list", body=b"raw")
    with pytest.raises(ValueError):
        store.read("other/eat/bid-list/" + "a" * 64 + ".xml.gz")

    assert s3.head_requests == []
    assert s3.get_requests == []


def test_settings_are_frozen_and_mask_endpoint_and_credentials() -> None:
    configured = settings()

    assert configured.secret_access_key.get_secret_value() == "secret-key"
    assert "secret-key" not in repr(configured)
    assert "access-id" not in repr(configured)
    assert "account.r2.cloudflarestorage.com" not in repr(configured)
    with pytest.raises(ValidationError):
        configured.bucket = "another"  # type: ignore[misc]


def test_settings_validate_all_required_values_without_leaking_input() -> None:
    marker = "must-not-leak.example"

    with pytest.raises(ValidationError) as captured:
        R2Settings(
            R2_ENDPOINT_URL=f"not-a-url-{marker}",
            R2_BUCKET="",
            R2_ACCESS_KEY_ID=f"access-{marker}",
            R2_SECRET_ACCESS_KEY=f"secret-{marker}",
        )

    assert marker not in str(captured.value)


def test_read_rejects_raw_hash_mismatch_even_when_metadata_matches_key() -> None:
    s3 = StatefulFakeS3Client()
    store = R2RawObjectStore(settings(), client=s3)
    expected_key = build_raw_object_key(
        source="eat", endpoint="bid-list", body=b"expected"
    )
    store.put(source="eat", endpoint="bid-list", body=b"expected")
    corrupt = s3.objects[expected_key]
    replacement = b"different"
    corrupt.body = deterministic_gzip(replacement)
    corrupt.content_length = len(corrupt.body)
    corrupt.metadata["source-byte-length"] = str(len(replacement))

    with pytest.raises(ObjectCorruptionError):
        store.read(expected_key)
