from __future__ import annotations

import pytest

from eatbid.core.build_identity import BUILD_SHA_PATTERN, validate_build_sha

RELEASE_COMMIT = "9c9ff63f479d03f0fbfcc036954e8470b182bb61"
LONG_HEX = "a" * 64


@pytest.mark.parametrize("value", [RELEASE_COMMIT, LONG_HEX])
def test_build_sha는_release_commit_40자와_64자_hex를_받는다(value: str) -> None:
    assert validate_build_sha(value) == value
    assert BUILD_SHA_PATTERN.fullmatch(value) is not None


@pytest.mark.parametrize(
    "value",
    [
        "a" * 39,
        "a" * 41,
        "a" * 63,
        "a" * 65,
        RELEASE_COMMIT.upper(),
        LONG_HEX.upper(),
        "9c9ff63f479d03f0fbfcc036954e8470b182bb6g",
        "",
        f" {RELEASE_COMMIT}",
    ],
)
def test_build_sha는_길이가_다르거나_소문자_hex가_아니면_거부한다(value: str) -> None:
    with pytest.raises(ValueError, match="lowercase 40 or 64 character"):
        validate_build_sha(value)


def test_build_sha는_문자열이_아니면_거부한다() -> None:
    with pytest.raises(ValueError, match="lowercase 40 or 64 character"):
        validate_build_sha(None)  # type: ignore[arg-type]
