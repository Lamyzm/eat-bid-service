from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from types import MappingProxyType
from uuid import UUID

_SLUG_PATTERN = re.compile(r"[a-z0-9-]+")
_SHA256_PATTERN = re.compile(r"[0-9a-f]{64}")


def _require_aware(value: datetime, field_name: str) -> None:
    if value.utcoffset() is None:
        raise ValueError(f"{field_name} must be timezone-aware")


def _freeze_params(params: Mapping[str, str]) -> Mapping[str, str]:
    if not isinstance(params, Mapping) or any(
        not isinstance(key, str) or not isinstance(value, str)
        for key, value in params.items()
    ):
        raise TypeError("request params must map strings to strings")
    return MappingProxyType(dict(params))


@dataclass(frozen=True, slots=True)
class CaptureRequest:
    request_unit_id: int
    run_id: UUID
    source: str
    endpoint: str
    params: Mapping[str, str]

    def __post_init__(self) -> None:
        if isinstance(self.request_unit_id, bool) or self.request_unit_id < 1:
            raise ValueError("request_unit_id must be a positive integer")
        if not isinstance(self.run_id, UUID):
            raise TypeError("run_id must be a UUID")
        if not isinstance(self.source, str) or _SLUG_PATTERN.fullmatch(self.source) is None:
            raise ValueError("source must be a lowercase kebab-case slug")
        if not isinstance(self.endpoint, str) or _SLUG_PATTERN.fullmatch(self.endpoint) is None:
            raise ValueError("endpoint must be a lowercase kebab-case slug")
        object.__setattr__(self, "params", _freeze_params(self.params))


@dataclass(frozen=True, slots=True)
class PlannedRequestUnit:
    request_unit_id: int
    run_id: UUID
    source: str
    endpoint: str
    params: Mapping[str, str]
    request_params_hash: str

    def __post_init__(self) -> None:
        CaptureRequest(
            self.request_unit_id,
            self.run_id,
            self.source,
            self.endpoint,
            self.params,
        )
        if _SHA256_PATTERN.fullmatch(self.request_params_hash) is None:
            raise ValueError("request_params_hash must be a lowercase SHA-256 digest")
        object.__setattr__(self, "params", _freeze_params(self.params))


@dataclass(frozen=True, slots=True)
class CapturedObservation:
    observation_id: int
    content_sha256: str
    object_key: str
    fetched_at: datetime

    def __post_init__(self) -> None:
        if isinstance(self.observation_id, bool) or self.observation_id < 1:
            raise ValueError("observation_id must be a positive integer")
        if _SHA256_PATTERN.fullmatch(self.content_sha256) is None:
            raise ValueError("content_sha256 must be a lowercase SHA-256 digest")
        if not self.object_key:
            raise ValueError("object_key is required")
        _require_aware(self.fetched_at, "fetched_at")
