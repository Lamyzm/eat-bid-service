import gzip
import traceback
from collections.abc import Callable
from datetime import UTC, datetime

import pytest
from botocore.exceptions import EndpointConnectionError
from pydantic import ValidationError

from eatbid.object_store import (
    build_raw_object_key,
    deterministic_gzip,
    raw_content_sha256,
)
from eatbid.r2_store import (
    ObjectCollisionError,
    ObjectCorruptionError,
    R2ProviderError,
    R2RawObjectStore,
    R2Settings,
)

from .fakes import FakeS3Object, StatefulFakeS3Client, client_error


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


def concurrent_object(body: bytes, *, last_modified: datetime) -> FakeS3Object:
    compressed = deterministic_gzip(body)
    return FakeS3Object(
        body=compressed,
        metadata={
            "source-sha256": raw_content_sha256(body),
            "source-byte-length": str(len(body)),
        },
        content_encoding="gzip",
        content_type="application/xml",
        last_modified=last_modified,
        content_length=len(compressed),
    )


def assert_redacted_provider_error(
    captured: pytest.ExceptionInfo[R2ProviderError], *, markers: tuple[str, ...]
) -> None:
    assert str(captured.value) == "R2 provider operation failed"
    assert captured.value.__cause__ is None
    rendered = "".join(traceback.format_exception(captured.value))
    for marker in markers:
        assert marker not in str(captured.value)
        assert marker not in rendered


def test_누락된_object_is_created_with_deterministic_archive_contract() -> None:
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
            "IfNoneMatch": "*",
            "Metadata": {
                "source-sha256": stored.content_sha256,
                "source-byte-length": str(len(body)),
            },
        }
    ]


def test_new_object_uses_provider_authoritative_last_modified_동작을_검증한다() -> None:
    s3 = StatefulFakeS3Client()
    store = R2RawObjectStore(settings(), client=s3)

    stored = store.put(source="eat", endpoint="bid-list", body=b"raw")

    assert stored.stored_at == s3.objects[stored.object_key].last_modified
    assert len(s3.head_requests) == 2


def test_post_put_head_provider_error_is_redacted_and_chainless_동작을_검증한다() -> None:
    marker = "post-put-head-endpoint-marker-must-not-leak"
    s3 = StatefulFakeS3Client()
    s3.head_error_after_put = EndpointConnectionError(endpoint_url=marker)
    store = R2RawObjectStore(settings(), client=s3)

    with pytest.raises(R2ProviderError) as captured:
        store.put(source="eat", endpoint="bid-list", body=b"raw")

    assert len(s3.put_requests) == 1
    assert_redacted_provider_error(captured, markers=(marker,))


def test_사전조건_race_reuses_an_identical_concurrent_winner() -> None:
    s3 = StatefulFakeS3Client()
    winner_timestamp = datetime(2025, 2, 3, 4, 5, 6, tzinfo=UTC)
    s3.concurrent_put_winner = concurrent_object(
        b"raw", last_modified=winner_timestamp
    )
    store = R2RawObjectStore(settings(), client=s3)

    stored = store.put(source="eat", endpoint="bid-list", body=b"raw")

    assert stored.stored_at == winner_timestamp
    assert len(s3.head_requests) == 2
    assert s3.put_requests[0]["IfNoneMatch"] == "*"


def test_사전조건_race_rejects_a_conflicting_concurrent_winner() -> None:
    s3 = StatefulFakeS3Client()
    s3.concurrent_put_winner = concurrent_object(
        b"different", last_modified=datetime(2025, 2, 3, tzinfo=UTC)
    )
    store = R2RawObjectStore(settings(), client=s3)

    with pytest.raises(ObjectCollisionError):
        store.put(source="eat", endpoint="bid-list", body=b"raw")

    assert len(s3.head_requests) == 2


def test_identical_existing_object_is_reused_with_original_timestamp_동작을_검증한다() -> None:
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
def test_existing_object_contract_mismatch_is_a_collision_동작을_검증한다(
    mutation: Callable[[FakeS3Object], None],
) -> None:
    s3 = StatefulFakeS3Client()
    store = R2RawObjectStore(settings(), client=s3)
    stored = store.put(source="eat", endpoint="bid-list", body=b"raw")
    mutation(s3.objects[stored.object_key])

    with pytest.raises(ObjectCollisionError):
        store.put(source="eat", endpoint="bid-list", body=b"raw")

    assert len(s3.put_requests) == 1


def test_only_explicit_not_found_is_treated_as_absent_동작을_검증한다() -> None:
    marker = "authorization-marker-must-not-leak"
    s3 = StatefulFakeS3Client()
    s3.head_error = client_error(
        "AccessDenied", "HeadObject", status=403, message=marker
    )
    store = R2RawObjectStore(settings(), client=s3)

    with pytest.raises(R2ProviderError) as captured:
        store.put(source="eat", endpoint="bid-list", body=b"raw")

    assert_redacted_provider_error(captured, markers=(marker,))
    assert s3.put_requests == []


def test_error_code_is_authoritative_over_a_misleading_404_status_동작을_검증한다() -> None:
    marker = "access-marker-must-not-leak"
    s3 = StatefulFakeS3Client()
    s3.head_error = client_error(
        "AccessDenied", "HeadObject", status=404, message=marker
    )
    store = R2RawObjectStore(settings(), client=s3)

    with pytest.raises(R2ProviderError) as captured:
        store.put(source="eat", endpoint="bid-list", body=b"raw")

    assert_redacted_provider_error(captured, markers=(marker,))
    assert s3.put_requests == []


def test_status_404_is_not_found_when_provider_omits_an_error_code_동작을_검증한다() -> None:
    s3 = StatefulFakeS3Client()
    s3.head_errors.append(client_error(None, "HeadObject", status=404))
    store = R2RawObjectStore(settings(), client=s3)

    stored = store.put(source="eat", endpoint="bid-list", body=b"raw")

    assert stored.byte_length == 3
    assert len(s3.put_requests) == 1


def test_head_transport_error_is_redacted_and_chainless_동작을_검증한다() -> None:
    endpoint_marker = "endpoint-marker-must-not-leak"
    s3 = StatefulFakeS3Client()
    s3.head_error = EndpointConnectionError(
        endpoint_url=f"https://{endpoint_marker}.example"
    )
    store = R2RawObjectStore(settings(), client=s3)

    with pytest.raises(R2ProviderError) as captured:
        store.put(source="eat", endpoint="bid-list", body=b"raw")

    assert_redacted_provider_error(captured, markers=(endpoint_marker,))
    assert s3.put_requests == []


def test_put_provider_error_is_redacted_and_chainless_동작을_검증한다() -> None:
    access_marker = "access-marker-must-not-leak"
    secret_marker = "secret-marker-must-not-leak"
    s3 = StatefulFakeS3Client()
    s3.put_error = client_error(
        "InternalError",
        "PutObject",
        status=500,
        message=f"{access_marker} {secret_marker}",
    )
    store = R2RawObjectStore(settings(), client=s3)

    with pytest.raises(R2ProviderError) as captured:
        store.put(source="eat", endpoint="bid-list", body=b"raw")

    assert_redacted_provider_error(
        captured, markers=(access_marker, secret_marker)
    )


def test_get_transport_error_is_redacted_and_chainless_동작을_검증한다() -> None:
    endpoint_marker = "endpoint-marker-must-not-leak"
    s3 = StatefulFakeS3Client()
    store = R2RawObjectStore(settings(), client=s3)
    stored = store.put(source="eat", endpoint="bid-list", body=b"raw")
    s3.get_error = EndpointConnectionError(
        endpoint_url=f"https://{endpoint_marker}.example"
    )

    with pytest.raises(R2ProviderError) as captured:
        store.read(stored.object_key)

    assert_redacted_provider_error(captured, markers=(endpoint_marker,))


def test_streaming_body_transport_error_is_redacted_and_chainless_동작을_검증한다() -> None:
    endpoint_marker = "stream-endpoint-marker-must-not-leak"
    s3 = StatefulFakeS3Client()
    store = R2RawObjectStore(settings(), client=s3)
    stored = store.put(source="eat", endpoint="bid-list", body=b"raw")
    s3.body_read_error = EndpointConnectionError(
        endpoint_url=f"https://{endpoint_marker}.example"
    )

    with pytest.raises(R2ProviderError) as captured:
        store.read(stored.object_key)

    assert_redacted_provider_error(captured, markers=(endpoint_marker,))


def test_읽기_round_trips_and_validates_the_stored_envelope() -> None:
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
def test_읽기_detects_corrupt_metadata_headers_or_body(
    mutation: Callable[[FakeS3Object], None],
) -> None:
    s3 = StatefulFakeS3Client()
    store = R2RawObjectStore(settings(), client=s3)
    stored = store.put(source="eat", endpoint="bid-list", body=b"raw")
    mutation(s3.objects[stored.object_key])

    with pytest.raises(ObjectCorruptionError):
        store.read(stored.object_key)


def test_유효하지_않은_put_slug_and_read_key_fail_before_s3_calls() -> None:
    s3 = StatefulFakeS3Client()
    store = R2RawObjectStore(settings(), client=s3)

    with pytest.raises(ValueError):
        store.put(source="../eat", endpoint="bid-list", body=b"raw")
    with pytest.raises(ValueError):
        store.read("other/eat/bid-list/" + "a" * 64 + ".xml.gz")

    assert s3.head_requests == []
    assert s3.get_requests == []


def test_설정_are_frozen_and_mask_endpoint_and_credentials() -> None:
    configured = settings()

    assert configured.secret_access_key.get_secret_value() == "secret-key"
    assert "secret-key" not in repr(configured)
    assert "access-id" not in repr(configured)
    assert "account.r2.cloudflarestorage.com" not in repr(configured)
    with pytest.raises(ValidationError):
        configured.bucket = "another"  # type: ignore[misc]


def test_설정_validate_all_required_values_without_leaking_input() -> None:
    marker = "must-not-leak.example"

    with pytest.raises(ValidationError) as captured:
        R2Settings(
            R2_ENDPOINT_URL=f"not-a-url-{marker}",
            R2_BUCKET="",
            R2_ACCESS_KEY_ID=f"access-{marker}",
            R2_SECRET_ACCESS_KEY=f"secret-{marker}",
        )

    assert marker not in str(captured.value)


@pytest.mark.parametrize(
    "endpoint_url",
    [
        "http://account.r2.cloudflarestorage.com",
        "https://evil.example",
        "https://r2.cloudflarestorage.com",
        "https://one.two.three.r2.cloudflarestorage.com",
        "https://user@account.r2.cloudflarestorage.com",
        "https://account.r2.cloudflarestorage.com/path",
        "https://account.r2.cloudflarestorage.com?query=1",
        "https://account.r2.cloudflarestorage.com#fragment",
        "https://account.r2.cloudflarestorage.com:8443",
        "https://account.r2.cloudflarestorage.com.evil.example",
    ],
)
def test_설정_reject_non_root_or_non_r2_endpoints(endpoint_url: str) -> None:
    with pytest.raises(ValidationError):
        R2Settings(
            R2_ENDPOINT_URL=endpoint_url,
            R2_BUCKET="eatbid-raw",
            R2_ACCESS_KEY_ID="access-id",
            R2_SECRET_ACCESS_KEY="secret-key",
        )


@pytest.mark.parametrize(
    "endpoint_url",
    [
        "https://account.r2.cloudflarestorage.com",
        "https://account.eu.r2.cloudflarestorage.com",
        "https://account.fedramp.r2.cloudflarestorage.com",
    ],
)
def test_설정_accept_account_and_jurisdiction_r2_endpoints(
    endpoint_url: str,
) -> None:
    configured = R2Settings(
        R2_ENDPOINT_URL=endpoint_url,
        R2_BUCKET="eatbid-raw",
        R2_ACCESS_KEY_ID="access-id",
        R2_SECRET_ACCESS_KEY="secret-key",
    )

    assert configured.endpoint_url.host is not None
    assert configured.endpoint_url.host.endswith(".r2.cloudflarestorage.com")


@pytest.mark.parametrize(
    "bucket",
    [
        "ab",
        "a" * 64,
        "-abc",
        "abc-",
        "ABC",
        "a_b",
        "a b",
    ],
)
def test_설정_reject_invalid_r2_bucket_names(bucket: str) -> None:
    with pytest.raises(ValidationError):
        R2Settings(
            R2_ENDPOINT_URL="https://account.r2.cloudflarestorage.com",
            R2_BUCKET=bucket,
            R2_ACCESS_KEY_ID="access-id",
            R2_SECRET_ACCESS_KEY="secret-key",
        )


@pytest.mark.parametrize(
    ("access_key_id", "secret_access_key"),
    [(" ", "secret-key"), ("access-id", "\t\n")],
)
def test_설정_reject_whitespace_only_credentials(
    access_key_id: str, secret_access_key: str
) -> None:
    with pytest.raises(ValidationError):
        R2Settings(
            R2_ENDPOINT_URL="https://account.r2.cloudflarestorage.com",
            R2_BUCKET="eatbid-raw",
            R2_ACCESS_KEY_ID=access_key_id,
            R2_SECRET_ACCESS_KEY=secret_access_key,
        )


def test_읽기_rejects_raw_hash_mismatch_even_when_metadata_matches_key() -> None:
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
