"""모듈 책임: capture run 시작·요청 계획·발견 request count 확정을 PostgreSQL에 기록한다."""

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime
from typing import Any
from uuid import UUID

import psycopg
from psycopg.types.json import Jsonb

from eatbid.core.build_identity import BUILD_SHA_PATTERN
from eatbid.ingest.models import CaptureRequest, PlannedRequestUnit
from eatbid.ingest.repository import CaptureRunMode, request_params_sha256

_CAPTURE_RUN_MODES = {"poll-open", "daily-reconcile", "backfill"}


class IngestIntegrityError(RuntimeError):
    """The persisted run ledger does not match the planned capture identity."""


class PlannedRequestMismatchError(IngestIntegrityError):
    """A capture does not match its preplanned request unit."""


class RawBlobIntegrityError(IngestIntegrityError):
    """A content hash exists with conflicting raw-object metadata."""


class TerminalCaptureStateError(IngestIntegrityError):
    """A failed request or run cannot accept another observation."""


class RunExpectedCountFinalizationError(IngestIntegrityError):
    """발견 완료 뒤 한 번 확정한 exact request count는 다시 바꿀 수 없다."""


def require_aware(value: datetime, field_name: str) -> None:
    if value.utcoffset() is None:
        raise ValueError(f"{field_name} must be timezone-aware")


def require_nonnegative(value: int, field_name: str) -> None:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError(f"{field_name} must be a nonnegative integer")


def require_capture_mode(mode: str) -> None:
    if mode not in _CAPTURE_RUN_MODES:
        raise IngestIntegrityError("capture repository operation requires capture mode")


class PostgresRunPlanningMixin:
    _connection: psycopg.Connection[Any]

    def start_run(
        self,
        *,
        run_id: UUID,
        mode: CaptureRunMode,
        build_sha: str,
        parser_version: str,
        started_at: datetime,
        expected_count: int,
    ) -> None:
        require_nonnegative(expected_count, "expected_count")
        require_aware(started_at, "started_at")
        if mode == "replay":
            raise ValueError(
                "replay runs must be created by ReplayRunRepository with a frozen manifest"
            )
        if (
            mode not in _CAPTURE_RUN_MODES
            or not parser_version
            or BUILD_SHA_PATTERN.fullmatch(build_sha) is None
        ):
            raise ValueError("run metadata is invalid")
        with self._connection.transaction(), self._connection.cursor() as cursor:
            cursor.execute(
                """
                insert into ingest.run (
                    run_id, mode, status, build_sha, parser_version, started_at,
                    expected_count, captured_count, published_count
                ) values (%s, %s, 'running', %s, %s, %s, %s, 0, 0)
                """,
                (run_id, mode, build_sha, parser_version, started_at, expected_count),
            )

    def plan_request_unit(
        self,
        *,
        run_id: UUID,
        source: str,
        endpoint: str,
        params: Mapping[str, str],
        expected_count: int,
    ) -> PlannedRequestUnit:
        require_nonnegative(expected_count, "expected_count")
        validated = CaptureRequest(1, run_id, source, endpoint, params)
        digest = request_params_sha256(validated.params)
        params_copy = dict(validated.params)
        with self._connection.transaction(), self._connection.cursor() as cursor:
            cursor.execute(
                "select mode, status from ingest.run where run_id = %s for update",
                (run_id,),
            )
            run = cursor.fetchone()
            if run is None:
                raise IngestIntegrityError("run does not exist")
            require_capture_mode(str(run[0]))
            if run[1] != "running":
                raise TerminalCaptureStateError(
                    "request units can only be planned for a running run"
                )
            cursor.execute(
                """
                insert into ingest.request_unit (
                    run_id, source, endpoint, request_params,
                    request_params_hash, expected_count, observed_count, status
                ) values (%s, %s, %s, %s, %s, %s, 0, 'planned')
                on conflict (run_id, source, endpoint, request_params_hash) do nothing
                returning request_unit_id
                """,
                (run_id, source, endpoint, Jsonb(params_copy), digest, expected_count),
            )
            row = cursor.fetchone()
            if row is None:
                cursor.execute(
                    """
                    select request_unit_id, request_params, expected_count
                    from ingest.request_unit
                    where run_id = %s and source = %s and endpoint = %s
                      and request_params_hash = %s
                    for update
                    """,
                    (run_id, source, endpoint, digest),
                )
                row = cursor.fetchone()
                if row is None or row[1:] != (params_copy, expected_count):
                    raise PlannedRequestMismatchError(
                        "existing request plan conflicts with requested metadata"
                    )
        return PlannedRequestUnit(
            request_unit_id=int(row[0]),
            run_id=run_id,
            source=source,
            endpoint=endpoint,
            params=params_copy,
            request_params_hash=digest,
        )

    def finalize_run_expected_count(
        self, *, run_id: UUID, expected_count: int
    ) -> None:
        require_nonnegative(expected_count, "expected_count")
        if expected_count < 1:
            raise ValueError("expected_count must be positive when finalized")
        with self._connection.transaction(), self._connection.cursor() as cursor:
            cursor.execute(
                """
                select expected_count, captured_count, status
                from ingest.run where run_id = %s for update
                """,
                (run_id,),
            )
            run = cursor.fetchone()
            if run is None:
                raise IngestIntegrityError("run does not exist")
            current_expected, captured_count, status = int(run[0]), int(run[1]), run[2]
            if status != "running" or captured_count != 1:
                raise RunExpectedCountFinalizationError(
                    "active bootstrap run must have captured exactly its first request"
                )
            if current_expected == expected_count:
                return
            if current_expected != 1:
                raise RunExpectedCountFinalizationError(
                    "run expected count can only be finalized from its bootstrap value"
                )
            cursor.execute(
                "update ingest.run set expected_count = %s where run_id = %s",
                (expected_count, run_id),
            )

    def complete_discovery_run(self, *, run_id: UUID, completed_at: datetime) -> None:
        require_aware(completed_at, "completed_at")
        with self._connection.transaction(), self._connection.cursor() as cursor:
            cursor.execute(
                """
                update ingest.run set status = 'validated'
                where run_id = %s and status = 'running'
                  and expected_count = captured_count
                  and expected_count = (
                    select count(*) from ingest.request_unit
                    where run_id = %s and status = 'captured'
                  )
                """,
                (run_id, run_id),
            )
            if cursor.rowcount != 1:
                raise RunExpectedCountFinalizationError(
                    "discovery run is not exact complete"
                )
