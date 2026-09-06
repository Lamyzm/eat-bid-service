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

# eaT 목록 조회의 날짜 창으로 번역되는 모드다. `discover --mode`가 받는 값이 정확히 이 셋이다.
CollectionRunMode = Literal["poll-open", "daily-reconcile", "backfill"]
# `reference`는 창이 없는 실행이다. 정부 공개 파일 한 벌이 곧 관측 하나여서 번역할 기간이 없다.
# run 정체성·실패 분류·관측 보존 규칙은 수집과 같으므로 run mode 목록에는 함께 두되, 창을 만드는
# 목록과는 분리한다. 하나로 두면 `discover --mode reference`가 받아들여지고 창이 비어 버린다.
ReferenceRunMode = Literal["reference"]
# 두 목록의 합을 Literal로 다시 적는 이유: `Literal[...] | Literal[...]`은 `get_args`가 문자열이
# 아니라 Literal 타입 둘을 돌려주어 값 검사가 조용히 통과한다. 셋이 어긋나지 않는지는
# `tests/unit/test_run_modes.py`가 고정한다.
CaptureRunMode = Literal["poll-open", "daily-reconcile", "backfill", "reference"]


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

    def reserve_capture(
        self, *, request: CaptureRequest, response: SourceResponse,
        content_sha256: str,
    ) -> CapturedObservation | None: ...

    def release_capture(self, *, request: CaptureRequest) -> None: ...

    def fail_run(
        self, *, run_id: UUID, failure_category: str, failed_at: datetime
    ) -> None: ...
