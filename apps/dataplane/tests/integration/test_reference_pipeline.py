from __future__ import annotations

from datetime import UTC, datetime
from io import BytesIO
from pathlib import Path
from uuid import uuid4
from zipfile import ZipFile

import httpx
import pytest

from eatbid.errors import SourceContractError
from eatbid.ingest.postgres_release_repository import PsycopgSourceReleaseRepository
from eatbid.ingest.postgres_repository import PsycopgObservationRepository
from eatbid.pipeline.reference import (
    ReferenceCapturePlan,
    ReferenceServices,
    capture_reference,
    project_reference,
)
from eatbid.source.reference.source_contracts import (
    LEGAL_DONG_DATASET,
    MOIS_STANDARD_CODE,
)

from ..unit.fakes import MemoryRawObjectStore
from .conftest import MigratedDatabase

SAMPLE_PATH = Path(__file__).parents[1] / "fixtures" / "reference" / "mois-legal-dong-sample.txt"
CAPTURED_AT = datetime(2026, 9, 6, 3, 19, 24, tzinfo=UTC)
BUILD_SHA = "e" * 64


def _archive(body: bytes) -> bytes:
    buffer = BytesIO()
    with ZipFile(buffer, "w") as bundle:
        bundle.writestr("법정동코드 전체자료.txt", body)
    return buffer.getvalue()


class _StaticReferenceClient:
    """계약된 요청 하나에 정해진 zip 하나로 답한다. 실제 정부 사이트를 테스트에서 부르지 않는다."""

    def __init__(self, archive: bytes) -> None:
        self._archive = archive
        self.requests: list[tuple[str, dict[str, str]]] = []

    def post(
        self, url: str, *, data: dict[str, str], headers: dict[str, str]
    ) -> httpx.Response:
        self.requests.append((url, data))
        return httpx.Response(200, content=self._archive, request=httpx.Request("POST", url))


@pytest.fixture
def connection(migrated_db: MigratedDatabase):
    with migrated_db.connect() as connection:
        yield connection
        connection.rollback()


def _plan() -> ReferenceCapturePlan:
    # release 이름은 (source, release_name) unique다. repository가 자기 transaction으로 커밋하므로
    # 테스트마다 다른 이름을 써야 세션 하나를 공유하는 DB에서 서로를 막지 않는다.
    return ReferenceCapturePlan(
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


def _services(connection, client) -> ReferenceServices:
    return ReferenceServices(
        http_client=client,
        store=MemoryRawObjectStore(lambda: CAPTURED_AT),
        ingest_repository=PsycopgObservationRepository(connection),
        release_repository=PsycopgSourceReleaseRepository(connection),
    )


def test_수집이_원본을_먼저_보존하고_release를_봉인한다(connection) -> None:
    client = _StaticReferenceClient(_archive(SAMPLE_PATH.read_bytes()))
    services = _services(connection, client)
    plan = _plan()

    result = capture_reference(plan, services)

    assert client.requests[0][1] == {"codeseId": "법정동코드"}
    assert result.member_count == 13
    with connection.cursor() as cursor:
        cursor.execute(
            "select status from ingest.source_release where source_release_id = %s",
            (str(plan.source_release_id),),
        )
        assert cursor.fetchone()[0] == "sealed"
        cursor.execute(
            """
            select b.object_key, b.content_type from ingest.raw_observation o
            join ingest.raw_blob b using (content_sha256) where o.observation_id = %s
            """,
            (result.observation_id,),
        )
        object_key, content_type = cursor.fetchone()
        # 저장 봉투가 내용에 대해 거짓말하지 않는다. 탭 구분 텍스트를 .xml.gz로 남기지 않는다.
        assert object_key.endswith(".txt.gz")
        assert content_type.startswith("text/plain")
    connection.rollback()


def test_계약이_깨진_파일은_봉인_전에_멈춘다(connection) -> None:
    broken = SAMPLE_PATH.read_bytes().decode("cp949").replace("폐지여부", "비고", 1)
    client = _StaticReferenceClient(_archive(broken.encode("cp949")))
    services = _services(connection, client)
    plan = _plan()

    with pytest.raises(SourceContractError):
        capture_reference(plan, services)

    connection.rollback()
    with connection.cursor() as cursor:
        cursor.execute(
            "select count(*) from ingest.source_release where source_release_id = %s",
            (str(plan.source_release_id),),
        )
        assert cursor.fetchone()[0] == 0
    connection.rollback()


def test_투영은_보존된_원본을_다시_읽어_core에_앉힌다(connection) -> None:
    client = _StaticReferenceClient(_archive(SAMPLE_PATH.read_bytes()))
    services = _services(connection, client)
    plan = _plan()
    captured = capture_reference(plan, services)

    with connection.cursor() as cursor:
        projected = project_reference(
            cursor,
            store=services.store,
            source_id=plan.source_id,
            dataset=plan.dataset,
            source_release_id=plan.source_release_id,
            observation_id=captured.observation_id,
            source_version=plan.release_name,
            projected_at=CAPTURED_AT,
        )
        assert projected.member_count == captured.member_count
        # 상위를 얻지 못한 member 수가 결과에 실린다. 표본에서는 시도 다섯과 상위 행이 없는 세종이다.
        assert projected.members_without_parent == 6
        cursor.execute(
            """
            select count(*) from core.code_value v
            join core.code_scheme s using (code_scheme_id)
            where s.namespace = 'mois:administrative-region'
            """
        )
        assert cursor.fetchone()[0] == captured.member_count
    connection.rollback()
