from __future__ import annotations

from decimal import Decimal
from io import BytesIO
from pathlib import Path
from uuid import uuid4
from zipfile import ZipFile

import httpx
import pytest

from eatbid.core.code_coordinate_projection import project_code_value_coordinates
from eatbid.ingest.postgres_release_repository import PsycopgSourceReleaseRepository
from eatbid.ingest.postgres_repository import PsycopgObservationRepository
from eatbid.pipeline.reference import (
    ReferenceCapturePlan,
    ReferenceServices,
    capture_reference,
    project_reference,
)
from eatbid.source.reference.centroid_parser import parse_centroid_rows
from eatbid.source.reference.source_contracts import (
    LEGAL_DONG_DATASET,
    MOIS_STANDARD_CODE,
)

from ..unit.fakes import MemoryRawObjectStore
from .conftest import MigratedDatabase
from .test_reference_pipeline import BUILD_SHA, CAPTURED_AT

LEGAL_DONG_SAMPLE = (
    Path(__file__).parents[1] / "fixtures" / "reference" / "mois-legal-dong-sample.txt"
)
CENTROID_SAMPLE = (
    Path(__file__).parents[1] / "fixtures" / "reference" / "sgg-centroid-sample.csv"
)


class _StaticReferenceClient:
    def __init__(self, archive: bytes) -> None:
        self._archive = archive

    def post(self, url: str, *, data: dict[str, str], headers: dict[str, str]) -> httpx.Response:
        return httpx.Response(200, content=self._archive, request=httpx.Request("POST", url))


def _archive(body: bytes) -> bytes:
    buffer = BytesIO()
    with ZipFile(buffer, "w") as bundle:
        bundle.writestr("법정동코드 전체자료.txt", body)
    return buffer.getvalue()


@pytest.fixture
def connection(migrated_db: MigratedDatabase):
    with migrated_db.connect() as connection:
        yield connection
        connection.rollback()


@pytest.fixture
def projected(connection):
    """좌표를 붙일 code release 하나를 실제 투영으로 만든다."""
    services = ReferenceServices(
        http_client=_StaticReferenceClient(_archive(LEGAL_DONG_SAMPLE.read_bytes())),
        store=MemoryRawObjectStore(lambda: CAPTURED_AT),
        ingest_repository=PsycopgObservationRepository(connection),
        release_repository=PsycopgSourceReleaseRepository(connection),
    )
    plan = ReferenceCapturePlan(
        run_id=uuid4(),
        source_release_id=uuid4(),
        source_id=MOIS_STANDARD_CODE,
        dataset=LEGAL_DONG_DATASET,
        release_name=f"legal-dong {uuid4()}",
        build_sha=BUILD_SHA,
        parser_version="mois-v1",
        as_of=CAPTURED_AT,
        started_at=CAPTURED_AT,
    )
    captured = capture_reference(plan, services)
    with connection.cursor() as cursor:
        result = project_reference(
            cursor,
            store=services.store,
            source_id=plan.source_id,
            dataset=plan.dataset,
            source_release_id=plan.source_release_id,
            observation_id=captured.observation_id,
            source_version=plan.release_name,
            projected_at=CAPTURED_AT,
        )
    return result.code_release_id, captured.observation_id


def test_좌표는_이름_경로가_유일할_때만_코드에_붙는다(connection, projected) -> None:
    code_release_id, observation_id = projected
    rows = parse_centroid_rows(CENTROID_SAMPLE.read_bytes())
    with connection.cursor() as cursor:
        result = project_code_value_coordinates(
            cursor, rows, code_release_id=code_release_id, observation_id=observation_id
        )
        # 강원도/춘천시는 이 release가 강원특별자치도로 부르므로 붙지 않는다. 표기 변이를 흡수하지 않는다.
        assert ("강원도", "춘천시") in result.unmatched_source_paths
        assert result.inserted_count == 4
        cursor.execute(
            """
            select v.code, c.latitude, c.longitude, c.crs
            from core.code_value_coordinate c
            join core.code_value v using (code_value_id)
            where c.code_release_id = %s order by v.code
            """,
            (code_release_id,),
        )
        placed = {row[0]: (row[1], row[2], row[3]) for row in cursor.fetchall()}
        assert placed["1111000000"] == (Decimal("37.573000"), Decimal("126.979000"), "EPSG:4326")
        assert "5111000000" not in placed
    connection.rollback()


def test_결측_시군구를_모구_좌표로_채우지_않고_목록으로_보고한다(connection, projected) -> None:
    code_release_id, observation_id = projected
    rows = parse_centroid_rows(CENTROID_SAMPLE.read_bytes())
    with connection.cursor() as cursor:
        result = project_code_value_coordinates(
            cursor, rows, code_release_id=code_release_id, observation_id=observation_id
        )
        # 강원특별자치도 춘천시는 좌표가 없다. 상위 강원특별자치도 좌표로도 채우지 않는다.
        assert "5111000000" in result.codes_without_coordinate
        assert "3611000000" in result.codes_without_coordinate
        cursor.execute(
            "select count(*) from core.code_value_coordinate where code_release_id = %s",
            (code_release_id,),
        )
        assert cursor.fetchone()[0] == result.inserted_count
    connection.rollback()


def test_같은_좌표_release를_두_번_투영해도_행이_늘지_않는다(connection, projected) -> None:
    code_release_id, observation_id = projected
    rows = parse_centroid_rows(CENTROID_SAMPLE.read_bytes())
    with connection.cursor() as cursor:
        first = project_code_value_coordinates(
            cursor, rows, code_release_id=code_release_id, observation_id=observation_id
        )
        second = project_code_value_coordinates(
            cursor, rows, code_release_id=code_release_id, observation_id=observation_id
        )
        assert second.inserted_count == 0
        cursor.execute(
            "select count(*) from core.code_value_coordinate where code_release_id = %s",
            (code_release_id,),
        )
        assert cursor.fetchone()[0] == first.inserted_count
    connection.rollback()
