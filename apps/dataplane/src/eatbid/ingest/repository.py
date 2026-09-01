"""모듈 책임: raw-first capture 실행과 observation 저장 port 계약을 정의한다."""

from __future__ import annotations

import json
from collections.abc import Mapping
from datetime import datetime
from hashlib import sha256
from typing import Literal, Protocol
from uuid import UUID

from eatbid.ingest.models import (
    CapturedObservation,
    CaptureRequest,
    PlannedRequestUnit,
)
from eatbid.object_store import StoredRawObject
from eatbid.source.client import SourceResponse

CaptureRunMode = Literal["poll-open", "daily-reconcile", "backfill"]


def canonical_request_params(params: Mapping[str, str]) -> bytes:
    if not isinstance(params, Mapping) or any(
        not isinstance(key, str) or not isinstance(value, str)
        for key, value in params.items()
    ):
        raise TypeError("request params must map strings to strings")
    try:
        rendered = json.dumps(
            dict(params),
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
        return rendered.encode("utf-8")
    except UnicodeEncodeError as error:
        raise ValueError("request params must contain valid Unicode") from error


def request_params_sha256(params: Mapping[str, str]) -> str:
    return sha256(canonical_request_params(params)).hexdigest()


class IngestRepository(Protocol):
    def start_run(
        self,
        *,
        run_id: UUID,
        mode: CaptureRunMode,
        build_sha: str,
        parser_version: str,
        started_at: datetime,
        expected_count: int,
    ) -> None: ...

    def plan_request_unit(
        self,
        *,
        run_id: UUID,
        source: str,
        endpoint: str,
        params: Mapping[str, str],
        expected_count: int,
    ) -> PlannedRequestUnit: ...

    def finalize_run_expected_count(
        self, *, run_id: UUID, expected_count: int
    ) -> None: ...

    def complete_discovery_run(self, *, run_id: UUID, completed_at: datetime) -> None: ...

    def record_observation(
        self,
        *,
        request: CaptureRequest,
        response: SourceResponse,
        stored: StoredRawObject,
        failure_category: str | None,
    ) -> CapturedObservation: ...

    def fail_run(
        self, *, run_id: UUID, failure_category: str, failed_at: datetime
    ) -> None: ...
