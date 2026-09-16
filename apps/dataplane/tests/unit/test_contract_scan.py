from __future__ import annotations

from datetime import UTC, datetime
from hashlib import sha256

import pytest

from eatbid.pipeline.contract_scan import ScanCandidate, scan_candidates
from eatbid.source.eat.normalize import EatDetailValidationError
from eatbid.source.eat.xml import NexacroParseError

_지금 = datetime(2026, 9, 16, 13, 0, tzinfo=UTC)


def _후보(index: int, body: bytes, bid: str | None = None) -> ScanCandidate:
    return ScanCandidate(
        observation_id=index,
        object_key=f"raw/eat/bid-detail/{index}.xml.gz",
        content_sha256=sha256(body).hexdigest(),
        external_bid_id=bid or f"56{index:05d}",
    )


def test_격리_사유를_문장_그대로_묶고_예시_공고를_다섯까지만_남긴다() -> None:
    bodies = {
        f"raw/eat/bid-detail/{i}.xml.gz": f"body-{i}".encode() for i in range(1, 10)
    }
    candidates = [
        _후보(i, bodies[f"raw/eat/bid-detail/{i}.xml.gz"]) for i in range(1, 10)
    ]

    def normalize(payload: bytes, *, external_bid_id: str, parser_version: str):
        index = int(payload.decode().split("-")[1])
        if index <= 7:
            raise EatDetailValidationError(
                "invalid eaT detail field: SAJEONG_PCT must be a source bid rate at most 999999999999.999 at scale 3"
            )
        if index == 8:
            raise NexacroParseError("ds_info is required")
        return object()

    보고 = scan_candidates(
        candidates,
        read_raw=lambda key: bodies[key],
        parser_version="eat-v3",
        now=_지금,
        normalize=normalize,
    )
    문서 = 보고.to_document()

    assert (
        문서["scanned"],
        문서["ok"],
        문서["quarantined"],
        문서["integrity_failures"],
    ) == (9, 1, 8, 0)
    assert 문서["reasons"][0]["count"] == 7
    assert 문서["reasons"][0]["reason"].startswith(
        "invalid eaT detail field: SAJEONG_PCT"
    )
    assert len(문서["reasons"][0]["sample_bid_ids"]) == 5
    assert 문서["reasons"][1] == {
        "reason": "ds_info is required",
        "count": 1,
        "sample_bid_ids": ["5600008"],
    }


def test_바이트가_지문과_다르면_파서를_돌리지_않고_무결성_실패로_센다() -> None:
    candidate = ScanCandidate(
        observation_id=1, object_key="k", content_sha256="0" * 64, external_bid_id="1"
    )

    def normalize(*args, **kwargs):
        raise AssertionError("파서가 불리면 안 된다")

    보고 = scan_candidates(
        [candidate],
        read_raw=lambda key: b"x",
        parser_version="eat-v3",
        now=_지금,
        normalize=normalize,
    )

    assert 보고.integrity_failures == 1 and 보고.quarantined == 0
    assert "(integrity)" in next(iter(보고.reasons))


def test_파싱_밖의_예외는_조사_결과가_아니라_조사의_실패라_그대로_올린다() -> None:
    body = b"body"

    def normalize(*args, **kwargs):
        raise RuntimeError("R2 is down")

    with pytest.raises(RuntimeError):
        scan_candidates(
            [_후보(1, body)],
            read_raw=lambda key: body,
            parser_version="eat-v3",
            now=_지금,
            normalize=normalize,
        )
