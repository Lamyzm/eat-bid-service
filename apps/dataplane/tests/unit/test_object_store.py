import gzip
from hashlib import sha256

import pytest
from eatbid.object_store import (
    build_raw_object_key,
    deterministic_gzip,
    parse_raw_object_key,
    raw_content_sha256,
)
from fakes import MemoryRawObjectStore
from hypothesis import given, settings
from hypothesis import strategies as st


@settings(max_examples=40, deadline=None, derandomize=True)
@given(body=st.binary(max_size=4096))
def test_content_address_and_gzip_are_deterministic_for_all_raw_bytes(
    body: bytes,
) -> None:
    first_key = build_raw_object_key(source="eat", endpoint="bid-list", body=body)
    second_key = build_raw_object_key(source="eat", endpoint="bid-list", body=body)
    first_gzip = deterministic_gzip(body)
    second_gzip = deterministic_gzip(body)

    assert first_key == second_key
    assert first_gzip == second_gzip
    assert gzip.decompress(first_gzip) == body
    assert raw_content_sha256(body) == sha256(body).hexdigest()
    assert parse_raw_object_key(first_key).content_sha256 == sha256(body).hexdigest()


@settings(max_examples=20, deadline=None, derandomize=True)
@given(body=st.binary(max_size=1024))
def test_source_and_endpoint_separate_content_address_namespaces(body: bytes) -> None:
    baseline = build_raw_object_key(source="eat", endpoint="bid-list", body=body)

    assert build_raw_object_key(source="neis", endpoint="bid-list", body=body) != baseline
    assert build_raw_object_key(source="eat", endpoint="bid-detail", body=body) != baseline


@pytest.mark.parametrize("body", [b"", b"\x00\xff\xfe\x80"])
def test_empty_and_non_utf8_raw_bytes_round_trip(body: bytes) -> None:
    assert gzip.decompress(deterministic_gzip(body)) == body


@pytest.mark.parametrize(
    ("source", "endpoint"),
    [
        ("", "bid-list"),
        ("EAT", "bid-list"),
        ("eat_api", "bid-list"),
        ("../eat", "bid-list"),
        ("eat", ""),
        ("eat", "Bid-List"),
        ("eat", "bid_list"),
        ("eat", "../bid-list"),
    ],
)
def test_invalid_namespace_slugs_are_rejected(source: str, endpoint: str) -> None:
    with pytest.raises(ValueError, match="slug"):
        build_raw_object_key(source=source, endpoint=endpoint, body=b"raw")


@pytest.mark.parametrize(
    "object_key",
    [
        "",
        "other/eat/bid-list/" + "a" * 64 + ".xml.gz",
        "raw/EAT/bid-list/" + "a" * 64 + ".xml.gz",
        "raw/eat/bid_list/" + "a" * 64 + ".xml.gz",
        "raw/eat/../" + "a" * 64 + ".xml.gz",
        "raw/eat/bid-list/not-a-digest.xml.gz",
        "raw/eat/bid-list/" + "A" * 64 + ".xml.gz",
        "raw/eat/bid-list/" + "a" * 63 + ".xml.gz",
        "raw/eat/bid-list/" + "a" * 64 + ".xml",
    ],
)
def test_malformed_or_foreign_object_keys_are_rejected(object_key: str) -> None:
    with pytest.raises(ValueError, match="object key"):
        parse_raw_object_key(object_key)


def test_known_content_address_matches_architecture_contract() -> None:
    assert build_raw_object_key(
        source="eat", endpoint="bid-list", body=b"<x>1</x>"
    ) == (
        "raw/eat/bid-list/"
        "a4753d7f1f568904517dcd1a4051192fe968de97095123e29756b6d645e7d6cf.xml.gz"
    )


def test_memory_port_fake_is_content_idempotent_and_replayable() -> None:
    store = MemoryRawObjectStore()

    first = store.put(source="eat", endpoint="bid-list", body=b"<x>1</x>")
    second = store.put(source="eat", endpoint="bid-list", body=b"<x>1</x>")

    assert first == second
    assert store.read(first.object_key) == b"<x>1</x>"
