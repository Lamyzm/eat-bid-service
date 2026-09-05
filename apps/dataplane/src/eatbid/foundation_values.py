"""모듈 책임: foundation checkpoint 판독이 쓰는 원시값 술어를 모아 위반 문구와 예외 종류를 한곳에서 소유한다."""

from __future__ import annotations

import re
from collections.abc import Mapping
from datetime import datetime

from eatbid.foundation_repository import FoundationIntegrityError

_SHA256_PATTERN = re.compile(r"[0-9a-f]{64}")

def _positive_int(value: object, field: str) -> None:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise FoundationIntegrityError(f"{field} must be a positive integer")


def _nonnegative_int(value: object, field: str) -> None:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise FoundationIntegrityError(f"{field} must be a nonnegative integer")


def _sha256(value: object, field: str) -> None:
    if not isinstance(value, str) or _SHA256_PATTERN.fullmatch(value) is None:
        raise FoundationIntegrityError(f"{field} must be a lowercase SHA-256 digest")


def _string_mapping(value: object, field: str) -> dict[str, str]:
    try:
        if not isinstance(value, Mapping):
            raise TypeError
        items = tuple(value.items())
        if any(
            not isinstance(key, str) or not isinstance(item, str)
            for key, item in items
        ):
            raise TypeError
        return dict(items)
    except (AttributeError, TypeError, ValueError) as error:
        raise FoundationIntegrityError(
            f"{field} must map strings to strings"
        ) from error


def _aware_datetime(value: object, field: str) -> None:
    if not isinstance(value, datetime) or value.utcoffset() is None:
        raise FoundationIntegrityError(f"{field} must be timezone-aware")


def _nonempty_string(value: object, field: str) -> None:
    if not isinstance(value, str) or not value.strip():
        raise FoundationIntegrityError(f"{field} must be a non-empty string")


def _http_status(value: object) -> None:
    if isinstance(value, bool) or not isinstance(value, int) or not 100 <= value <= 599:
        raise FoundationIntegrityError("observation http_status must be an HTTP status")
