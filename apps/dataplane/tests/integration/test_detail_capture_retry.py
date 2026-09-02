from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from threading import Barrier
from typing import Any
from uuid import uuid4

import psycopg

from eatbid.ingest.models import CaptureRequest
from eatbid.ingest.postgres_repository import PsycopgObservationRepository
from eatbid.pipeline.capture import capture
from eatbid.source.client import SourceResponse

from ..unit.fakes import MemoryRawObjectStore, StaticSourceClient
from .conftest import MigratedDatabase

NOW = datetime(2026, 9, 1, 3, 0, tzinfo=UTC)


def _요청(repository: PsycopgObservationRepository) -> CaptureRequest:
    run_id = uuid4()
    repository.start_run(
        run_id=run_id,
        mode="backfill",
        build_sha="a" * 64,
        parser_version="eat-v1",
        started_at=NOW,
        expected_count=1,
    )
    planned = repository.plan_request_unit(
        run_id=run_id,
        source="eat",
        endpoint="bid-detail",
        params={"ELCTRN_BID_ID": "5610615"},
        expected_count=1,
    )
    return CaptureRequest(
        planned.request_unit_id,
        planned.run_id,
        planned.source,
        planned.endpoint,
        planned.params,
    )


class _동시응답:
    def __init__(self, barrier: Barrier) -> None:
        self._barrier = barrier

    def fetch(self, request: CaptureRequest) -> SourceResponse:
        self._barrier.wait(timeout=10)
        return SourceResponse(200, b"<detail>same</detail>", NOW)


def test_detail_request_재시도는_같은_canonical_observation을_반환한다(
    migrated_db: MigratedDatabase,
) -> None:
    connection = migrated_db.connect()
    try:
        repository = PsycopgObservationRepository(connection)
        request = _요청(repository)
        store = MemoryRawObjectStore(now=lambda: NOW)
        client = StaticSourceClient(SourceResponse(200, b"<detail>same</detail>", NOW))

        first = capture(request, store, repository, client)
        second = capture(request, store, repository, client)

        retry_connection = migrated_db.connect()
        try:
            with retry_connection.transaction(), retry_connection.cursor() as cursor:
                cursor.execute("set local lock_timeout = '500ms'")
                third = capture(
                    request,
                    store,
                    PsycopgObservationRepository(retry_connection),
                    client,
                )
        finally:
            retry_connection.close()

        assert second == first
        assert third == first
        _단일관측을_확인한다(connection, request)
        assert store.object_count == 1
    finally:
        connection.close()


def test_detail_request_동시_capture도_raw_observation을_하나만_만든다(
    migrated_db: MigratedDatabase,
) -> None:
    first_connection = migrated_db.connect()
    second_connection = migrated_db.connect()
    try:
        first_repository = PsycopgObservationRepository(first_connection)
        request = _요청(first_repository)
        store = MemoryRawObjectStore(now=lambda: NOW)
        barrier = Barrier(2)

        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = tuple(
                executor.submit(
                    capture,
                    request,
                    store,
                    repository,
                    _동시응답(barrier),
                )
                for repository in (
                    first_repository,
                    PsycopgObservationRepository(second_connection),
                )
            )
            observations = tuple(future.result(timeout=15) for future in futures)

        assert observations[0] == observations[1]
        _단일관측을_확인한다(first_connection, request)
    finally:
        second_connection.close()
        first_connection.close()


def test_detail_request_재시도_body가_달라도_canonical_observation을_지킨다(
    migrated_db: MigratedDatabase,
) -> None:
    # 2026-09-03 실측: eaT 상세 응답은 마감까지 남은 시간을 REM_SEC·REM_MIN·TOTAL_SEC로 실어
    # 보내 매 호출마다 바이트가 다르다. 재시도에 byte 동일성을 요구하면 전송 오류 한 번으로
    # 그 공고가 run 안에서 영구히 막힌다.
    connection = migrated_db.connect()
    try:
        repository = PsycopgObservationRepository(connection)
        request = _요청(repository)
        store = MemoryRawObjectStore(now=lambda: NOW)
        first = capture(
            request,
            store,
            repository,
            StaticSourceClient(SourceResponse(200, b"<detail>first</detail>", NOW)),
        )

        retried = capture(
            request,
            store,
            repository,
            StaticSourceClient(
                SourceResponse(200, b"<detail>REM_SEC=44</detail>", NOW)
            ),
        )

        assert retried == first
        _단일관측을_확인한다(connection, request)
        assert store.object_count == 1
    finally:
        connection.close()


def _단일관측을_확인한다(
    connection: psycopg.Connection[Any], request: CaptureRequest
) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            "select count(*) from ingest.raw_observation where request_unit_id = %s",
            (request.request_unit_id,),
        )
        assert cursor.fetchone() == (1,)
        cursor.execute(
            "select observed_count, status from ingest.request_unit where request_unit_id = %s",
            (request.request_unit_id,),
        )
        assert cursor.fetchone() == (1, "captured")
        cursor.execute(
            "select captured_count from ingest.run where run_id = %s",
            (request.run_id,),
        )
        assert cursor.fetchone() == (1,)
