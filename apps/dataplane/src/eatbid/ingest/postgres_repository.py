"""모듈 책임: raw observation과 capture run terminal 상태를 PostgreSQL에 기록한다."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

import psycopg
from psycopg.types.json import Jsonb

from eatbid.ingest.models import (
    CapturedObservation,
    CaptureRequest,
)
from eatbid.ingest.postgres_run_planning import (
    IngestIntegrityError,
    PlannedRequestMismatchError,
    PostgresRunPlanningMixin,
    RawBlobIntegrityError,
    TerminalCaptureStateError,
    require_aware,
    require_capture_mode,
)
from eatbid.ingest.repository import request_params_sha256
from eatbid.source.client import SourceResponse
from eatbid.storage.object_store import (
    MEDIA_TEXT,
    MEDIA_XML,
    StoredRawObject,
    parse_raw_object_key,
)

# blob 봉투는 객체 키가 말하는 미디어를 따른다. 상수 하나로 고정하면 탭 구분 텍스트를 받은 날
# 저장 메타데이터가 내용에 대해 거짓말을 한다.
_CONTENT_TYPES = {MEDIA_XML: "application/xml", MEDIA_TEXT: "text/plain; charset=cp949"}
_CONTENT_ENCODING = "gzip"


def _content_type(object_key: str) -> str:
    return _CONTENT_TYPES[parse_raw_object_key(object_key).media]
class PsycopgObservationRepository(PostgresRunPlanningMixin):
    def __init__(self, connection: psycopg.Connection[Any]) -> None:
        self._connection = connection

    def record_observation(
        self,
        *,
        request: CaptureRequest,
        response: SourceResponse,
        stored: StoredRawObject,
        failure_category: str | None,
    ) -> CapturedObservation:
        require_aware(stored.stored_at, "stored_at")
        params_hash = request_params_sha256(request.params)
        params_copy = dict(request.params)
        failed = failure_category is not None
        with self._connection.transaction(), self._connection.cursor() as cursor:
            request_status = self._lock_and_verify_request(
                cursor,
                request=request,
                params_hash=params_hash,
                params=params_copy,
            )
            if request.endpoint == "bid-detail" and request_status != "planned":
                raise PlannedRequestMismatchError("detail capture was not reserved")
            cursor.execute(
                """
                insert into ingest.raw_blob (
                    content_sha256, object_key, byte_length, content_type,
                    content_encoding, stored_at
                ) values (%s, %s, %s, %s, %s, %s)
                on conflict (content_sha256) do nothing
                """,
                (
                    stored.content_sha256,
                    stored.object_key,
                    stored.byte_length,
                    _content_type(stored.object_key),
                    _CONTENT_ENCODING,
                    stored.stored_at,
                ),
            )
            self._lock_and_verify_blob(cursor, stored)
            cursor.execute(
                """
                insert into ingest.raw_observation (
                    run_id, request_unit_id, source, endpoint, request_params,
                    fetched_at, http_status, content_sha256
                ) values (%s, %s, %s, %s, %s, %s, %s, %s)
                returning observation_id
                """,
                (
                    request.run_id,
                    request.request_unit_id,
                    request.source,
                    request.endpoint,
                    Jsonb(params_copy),
                    response.fetched_at,
                    response.status_code,
                    stored.content_sha256,
                ),
            )
            observation = cursor.fetchone()
            # attempt_count는 이 관측을 얻기까지 든 HTTP 시도 횟수다. 실패 카테고리와 달리 성공한
            # 요청에도 남아야 소스가 얼마나 불안정했는지를 사후에 셀 수 있다.
            cursor.execute(
                """
                update ingest.request_unit
                set observed_count = observed_count + 1,
                    attempt_count = %s,
                    status = case when %s then 'failed' else 'captured' end
                where request_unit_id = %s and run_id = %s
                  and status in ('planned', 'captured')
                """,
                (
                    response.attempts,
                    failed,
                    request.request_unit_id,
                    request.run_id,
                ),
            )
            if cursor.rowcount != 1:
                raise PlannedRequestMismatchError("planned request unit disappeared")
            cursor.execute(
                """
                update ingest.run
                set captured_count = captured_count + 1,
                    status = case when %s then 'failed' else 'running' end,
                    failure_category = case when %s then %s else failure_category end,
                    ended_at = case when %s then %s else ended_at end
                where run_id = %s and status = 'running'
                """,
                (
                    failed,
                    failed,
                    failure_category,
                    failed,
                    response.fetched_at,
                    request.run_id,
                ),
            )
            if cursor.rowcount != 1 or observation is None:
                raise IngestIntegrityError("run ledger update failed")
        return CapturedObservation(
            observation_id=int(observation[0]),
            content_sha256=stored.content_sha256,
            object_key=stored.object_key,
            fetched_at=response.fetched_at,
        )

    def reserve_capture(
        self, *, request: CaptureRequest, response: SourceResponse,
        content_sha256: str,
    ) -> CapturedObservation | None:
        if request.endpoint != "bid-detail":
            return None
        with self._connection.transaction(), self._connection.cursor() as cursor:
            cursor.execute("select pg_advisory_lock(%s)", (request.request_unit_id,))
        try:
            with self._connection.transaction(), self._connection.cursor() as cursor:
                status = self._lock_and_verify_request(
                    cursor, request=request,
                    params_hash=request_params_sha256(request.params),
                    params=dict(request.params),
                )
                if status == "planned":
                    return None
                return self._canonical_detail_observation(cursor, request)
        except Exception:
            self.release_capture(request=request)
            raise

    def find_captured_observation(
        self, *, request: CaptureRequest
    ) -> CapturedObservation | None:
        """왜: 같은 run에서 이미 관측한 상세 unit은 소스를 다시 부를 이유가 없다. 실패한 chunk를 다시
        돌리는 운영 재시도가 이미 받은 건까지 재호출하면 한 달 창이 처음부터가 되고 소스만 한 번 더
        두드린다(EAT-122). 목록 unit은 append-only 다중 관측이 정상이라 여기서 판단하지 않는다."""
        if request.endpoint != "bid-detail":
            return None
        with self._connection.transaction(), self._connection.cursor() as cursor:
            status = self._lock_and_verify_request(
                cursor,
                request=request,
                params_hash=request_params_sha256(request.params),
                params=dict(request.params),
            )
            if status != "captured":
                return None
            return self._canonical_detail_observation(cursor, request)

    @staticmethod
    def _canonical_detail_observation(
        cursor: psycopg.Cursor[Any], request: CaptureRequest
    ) -> CapturedObservation:
        cursor.execute(
            """
            select o.observation_id, o.http_status, o.content_sha256,
                   o.fetched_at, b.object_key
            from ingest.raw_observation o
            join ingest.raw_blob b using (content_sha256)
            where o.request_unit_id = %s and o.run_id = %s
            """,
            (request.request_unit_id, request.run_id),
        )
        rows = cursor.fetchall()
        # 왜 응답 body를 대조하지 않나. 2026-09-03 실측에서 eaT 상세 응답은 마감까지 남은
        # 시간을 실어 보내 매 호출마다 바이트가 다르다. byte 동일성을 요구하면 전송 오류
        # 한 번으로 그 공고가 run 안에서 영구히 막힌다. 계획된 요청 하나는 run 안에서 한 번
        # 관측되며, 재호출은 세계를 다시 관측하는 것이 아니라 운영상의 재시도다. 세계를 다시
        # 관측하려면 새 run이 요청을 다시 계획해야 한다. 요청 동일성은 params hash가 이미
        # 검증했다.
        if len(rows) != 1:
            raise PlannedRequestMismatchError(
                "detail request unit must have exactly one canonical observation"
            )
        row = rows[0]
        return CapturedObservation(int(row[0]), str(row[2]), str(row[4]), row[3])

    def release_capture(self, *, request: CaptureRequest) -> None:
        if request.endpoint == "bid-detail":
            with self._connection.transaction(), self._connection.cursor() as cursor:
                cursor.execute(
                    "select pg_advisory_unlock(%s)", (request.request_unit_id,)
                )

    def fail_run(
        self, *, run_id: UUID, failure_category: str, failed_at: datetime
    ) -> None:
        require_aware(failed_at, "failed_at")
        if not failure_category:
            raise ValueError("failure_category is required")
        with self._connection.transaction(), self._connection.cursor() as cursor:
            cursor.execute(
                """
                select mode, status, failure_category, ended_at
                from ingest.run where run_id = %s
                for update
                """,
                (run_id,),
            )
            current = cursor.fetchone()
            if current is None:
                raise IngestIntegrityError("run does not exist")
            require_capture_mode(str(current[0]))
            if current[1] == "failed":
                if current[2] == failure_category:
                    return
                raise TerminalCaptureStateError(
                    "failed run metadata cannot be overwritten"
                )
            if current[1] not in {"planned", "running"}:
                raise TerminalCaptureStateError(
                    "validated or published runs cannot be failed"
                )
            cursor.execute(
                """
                update ingest.run
                set status = 'failed', failure_category = %s, ended_at = %s
                where run_id = %s
                """,
                (failure_category, failed_at, run_id),
            )
            if cursor.rowcount != 1:
                raise IngestIntegrityError("run update failed")

    @staticmethod
    def _lock_and_verify_request(
        cursor: psycopg.Cursor[Any],
        *,
        request: CaptureRequest,
        params_hash: str,
        params: dict[str, str],
    ) -> str:
        cursor.execute(
            """
            select unit.source, unit.endpoint, unit.request_params,
                   unit.request_params_hash, unit.status, run.mode, run.status
            from ingest.request_unit unit
            join ingest.run run on run.run_id = unit.run_id
            where unit.request_unit_id = %s and unit.run_id = %s
            for update of unit, run
            """,
            (request.request_unit_id, request.run_id),
        )
        row = cursor.fetchone()
        if row is None or row[:4] != (
            request.source,
            request.endpoint,
            params,
            params_hash,
        ):
            raise PlannedRequestMismatchError("capture does not match planned request")
        require_capture_mode(str(row[5]))
        if row[4] not in {"planned", "captured"} or row[6] != "running":
            raise TerminalCaptureStateError(
                "only active request and run states can record observations"
            )
        return str(row[4])

    @staticmethod
    def _lock_and_verify_blob(
        cursor: psycopg.Cursor[Any], stored: StoredRawObject
    ) -> None:
        cursor.execute(
            """
            select object_key, byte_length, content_type, content_encoding, stored_at
            from ingest.raw_blob
            where content_sha256 = %s
            for update
            """,
            (stored.content_sha256,),
        )
        row = cursor.fetchone()
        expected = (
            stored.object_key,
            stored.byte_length,
            _content_type(stored.object_key),
            _CONTENT_ENCODING,
            stored.stored_at,
        )
        if row != expected:
            raise RawBlobIntegrityError("raw blob metadata conflicts with its digest")
