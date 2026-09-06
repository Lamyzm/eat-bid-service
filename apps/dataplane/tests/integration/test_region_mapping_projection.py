from __future__ import annotations

from io import BytesIO
from pathlib import Path
from uuid import uuid4
from zipfile import ZipFile

import httpx
import pytest

from eatbid.core.postgres_code_values import resolve_code_value, resolve_label
from eatbid.core.region_mapping import OVERLAPS_RELATION
from eatbid.core.region_mapping_projection import (
    build_region_mapping_proposal,
    project_region_mappings,
    record_reviewed_mapping,
)
from eatbid.ingest.postgres_release_repository import PsycopgSourceReleaseRepository
from eatbid.ingest.postgres_repository import PsycopgObservationRepository
from eatbid.pipeline.reference import (
    ReferenceCapturePlan,
    ReferenceServices,
    capture_reference,
    project_reference,
)
from eatbid.source.eat.code_schemes import AUCTION_LOCATION_SIDO, ELIGIBILITY_AREA
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
def release(connection):
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
    return projected.code_release_id, captured.observation_id


def _observe_eat_code(cursor, *, namespace: str, code: str, label: str | None, observation_id: int) -> int:
    """관측된 eaT 코드 하나를 앉힌다. 세션 하나를 공유하는 DB이므로 삽입은 멱등이어야 한다."""
    code_value_id, _inserted = resolve_code_value(
        cursor, namespace=namespace, code=code, allow_insert=True
    )
    if label is not None:
        resolve_label(
            cursor,
            code_value_id=code_value_id,
            label=label,
            observation_id=observation_id,
            observed_at=CAPTURED_AT,
            allow_insert=True,
        )
    return code_value_id


def test_매핑은_근거_observation과_유효기간_경계를_반드시_갖는다(connection, release) -> None:
    code_release_id, observation_id = release
    with connection.cursor() as cursor:
        _observe_eat_code(
            cursor,
            namespace=ELIGIBILITY_AREA.namespace,
            code="01000",
            label="서울특별시 / 전체",
            observation_id=observation_id,
        )
        result = project_region_mappings(
            cursor,
            from_scheme=ELIGIBILITY_AREA.namespace,
            code_release_id=code_release_id,
            observation_id=observation_id,
            valid_from=CAPTURED_AT,
        )
        assert result.created_count == 1
        cursor.execute(
            """
            select relation, status, valid_from, evidence_observation_id
            from core.code_mapping where evidence_observation_id = %s
            """,
            (observation_id,),
        )
        relation, status, valid_from, evidence = cursor.fetchone()
        assert (relation, status) == ("exact", "label_verified")
        assert valid_from == CAPTURED_AT
        assert evidence == observation_id
    connection.rollback()


def test_매핑없는_코드는_행_대신_미매핑_수로_보고된다(connection, release) -> None:
    code_release_id, observation_id = release
    with connection.cursor() as cursor:
        # 관측된 라벨이 없는 코드(eaT SIDO_CD에는 이름 column이 없다)와 이름이 다른 코드를 함께 둔다.
        no_label = _observe_eat_code(
            cursor,
            namespace=AUCTION_LOCATION_SIDO.namespace,
            code="11",
            label=None,
            observation_id=observation_id,
        )
        short_name = _observe_eat_code(
            cursor,
            namespace=AUCTION_LOCATION_SIDO.namespace,
            code="18",
            label="전남",
            observation_id=observation_id,
        )
        proposal = build_region_mapping_proposal(
            cursor,
            from_scheme=AUCTION_LOCATION_SIDO.namespace,
            code_release_id=code_release_id,
        )
        assert proposal.candidates == ()
        assert no_label in proposal.source_code_value_ids_without_label
        # `전남`은 이 release가 부르는 어떤 이름과도 같지 않다. 부분 문자열로 잇지 않는다.
        assert short_name in proposal.unmatched_source_code_value_ids

        result = project_region_mappings(
            cursor,
            from_scheme=AUCTION_LOCATION_SIDO.namespace,
            code_release_id=code_release_id,
            observation_id=observation_id,
            valid_from=CAPTURED_AT,
        )
        assert result.created_count == 0
        assert result.mapped_count == 0
        cursor.execute(
            "select count(*) from core.code_mapping where from_code_value_id in (%s, %s)",
            (no_label, short_name),
        )
        assert cursor.fetchone()[0] == 0
    connection.rollback()


def test_전남광주가_한_코드에_묶인_경우_overlaps_두_행을_사람이_만든다(connection, release) -> None:
    code_release_id, observation_id = release
    with connection.cursor() as cursor:
        sido_18 = _observe_eat_code(
            cursor,
            namespace=AUCTION_LOCATION_SIDO.namespace,
            code="18",
            label="전남",
            observation_id=observation_id,
        )
        cursor.execute(
            """
            select m.code_value_id, v.code from core.code_release_member m
            join core.code_value v using (code_value_id)
            where m.code_release_id = %s and v.code in ('1200000000', '2900000000')
            order by v.code
            """,
            (code_release_id,),
        )
        targets = [int(row[0]) for row in cursor.fetchall()]
        assert len(targets) == 2

        for target in targets:
            assert record_reviewed_mapping(
                cursor,
                from_code_value_id=sido_18,
                to_code_value_id=target,
                relation=OVERLAPS_RELATION,
                valid_from=CAPTURED_AT,
                observation_id=observation_id,
            )

        # 자동 경로는 이 관계를 만들지 않는다. 후보 목록에도 나오지 않는다.
        proposal = build_region_mapping_proposal(
            cursor,
            from_scheme=AUCTION_LOCATION_SIDO.namespace,
            code_release_id=code_release_id,
        )
        assert all(item.relation != OVERLAPS_RELATION for item in proposal.candidates)

        cursor.execute(
            "select relation, status from core.code_mapping where from_code_value_id = %s",
            (sido_18,),
        )
        rows = cursor.fetchall()
        assert len(rows) == 2
        assert {(row[0], row[1]) for row in rows} == {("overlaps", "reviewed")}
    connection.rollback()


def test_같은_매핑을_두_번_투영해도_행이_늘지_않는다(connection, release) -> None:
    code_release_id, observation_id = release
    with connection.cursor() as cursor:
        _observe_eat_code(
            cursor,
            namespace=ELIGIBILITY_AREA.namespace,
            code="01000",
            label="서울특별시/전체",
            observation_id=observation_id,
        )
        first = project_region_mappings(
            cursor,
            from_scheme=ELIGIBILITY_AREA.namespace,
            code_release_id=code_release_id,
            observation_id=observation_id,
            valid_from=CAPTURED_AT,
        )
        second = project_region_mappings(
            cursor,
            from_scheme=ELIGIBILITY_AREA.namespace,
            code_release_id=code_release_id,
            observation_id=observation_id,
            valid_from=CAPTURED_AT,
        )
        assert first.created_count == 1
        assert second.created_count == 0
        assert second.already_present_count == 1
        cursor.execute(
            "select count(*) from core.code_mapping where evidence_observation_id = %s",
            (observation_id,),
        )
        assert cursor.fetchone()[0] == 1
    connection.rollback()
