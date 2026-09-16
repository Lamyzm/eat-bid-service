from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import pytest

from eatbid.core.code_vocabulary_projection import PARENT_RELATION
from eatbid.failures.errors import SourceContractError
from eatbid.ingest.postgres_release_repository import PsycopgSourceReleaseRepository
from eatbid.ingest.postgres_repository import PsycopgObservationRepository
from eatbid.pipeline.code_vocabulary import (
    CodeVocabularyCapturePlan,
    CodeVocabularyServices,
    capture_code_vocabulary,
    project_code_vocabulary_observation,
)
from eatbid.source.client import SourceResponse
from eatbid.source.eat.code_schemes import (
    ATTEMPT_STATUS,
    AUCTION_LOCATION_SIDO,
    AUCTION_LOCATION_SIGUNGU,
    ORGANIZATION_TYPE,
)

from ..unit.fakes import MemoryRawObjectStore, StaticSourceClient
from .conftest import MigratedDatabase

FIXTURE = Path(__file__).parents[1] / "fixtures" / "eat" / "code-list.xml"
CAPTURED_AT = datetime(2026, 9, 16, 5, 10, 0, tzinfo=UTC)
BUILD_SHA = "d" * 64
PARSER_VERSION = "eat-v1"


@pytest.fixture
def connection(migrated_db: MigratedDatabase):
    with migrated_db.connect() as connection:
        yield connection
        connection.rollback()


def _plan() -> CodeVocabularyCapturePlan:
    # release 이름은 (source, release_name) unique다. repository가 자기 transaction으로 커밋하므로
    # 테스트마다 다른 이름을 써야 세션 하나를 공유하는 DB에서 서로를 막지 않는다.
    return CodeVocabularyCapturePlan(
        run_id=uuid4(),
        source_release_id=uuid4(),
        release_name=f"eat-code-vocabulary {uuid4()}",
        build_sha=BUILD_SHA,
        parser_version=PARSER_VERSION,
        as_of=CAPTURED_AT,
        started_at=CAPTURED_AT,
    )


def _services(connection, body: bytes) -> CodeVocabularyServices:
    return CodeVocabularyServices(
        http_client=StaticSourceClient(SourceResponse(200, body, CAPTURED_AT)),
        store=MemoryRawObjectStore(lambda: CAPTURED_AT),
        ingest_repository=PsycopgObservationRepository(connection),
        release_repository=PsycopgSourceReleaseRepository(connection),
    )


def _parents(cursor) -> list[tuple[str, str]]:
    cursor.execute(
        """
        select child.code, parent.code
        from core.code_mapping mapping
        join core.code_value child on child.code_value_id = mapping.from_code_value_id
        join core.code_value parent on parent.code_value_id = mapping.to_code_value_id
        where mapping.relation = %s
        order by child.code
        """,
        (PARENT_RELATION,),
    )
    return [(row[0], row[1]) for row in cursor.fetchall()]


def _label(cursor, namespace: str, code: str) -> tuple[str, bool] | None:
    cursor.execute(
        """
        select observed.label, value.active
        from core.code_value value
        join core.code_scheme scheme using (code_scheme_id)
        left join lateral (
          select label.label from core.code_label_observation label
           where label.code_value_id = value.code_value_id
           order by label.observed_at desc, label.code_label_observation_id desc
           limit 1
        ) observed on true
        where scheme.namespace = %s and value.code = %s
        """,
        (namespace, code),
    )
    return cursor.fetchone()


def test_수집이_원본을_먼저_보존하고_release를_봉인한다(connection) -> None:
    services = _services(connection, FIXTURE.read_bytes())
    plan = _plan()

    result = capture_code_vocabulary(plan, services)

    assert result.entry_count == 17
    assert result.excluded_row_count == 0
    with connection.cursor() as cursor:
        cursor.execute(
            "select status from ingest.source_release where source_release_id = %s",
            (str(plan.source_release_id),),
        )
        assert cursor.fetchone()[0] == "sealed"
        cursor.execute(
            """
            select b.object_key from ingest.raw_observation o
            join ingest.raw_blob b using (content_sha256) where o.observation_id = %s
            """,
            (result.observation_id,),
        )
        assert cursor.fetchone()[0].startswith("raw/eat/code-list/")
    connection.rollback()


def test_모양이_달라진_응답은_원본으로_남되_봉인되지_않는다(connection) -> None:
    """필수 column이 사라진 응답은 어휘가 되지 못한다. 그래도 원본은 이미 보존돼 있어야 한다.

    코드목록에는 격리 단위가 없다. 공고는 건별로 격리해 나머지를 발행할 수 있지만 어휘는 한 벌이
    통째로 활성 이름이 되므로, 일부를 싣는 대신 전체를 멈추고 봉인하지 않는다.
    """
    broken = FIXTURE.read_bytes().replace(b"VLD_END_YMD", b"VLD_END")
    services = _services(connection, broken)
    plan = _plan()

    with pytest.raises(SourceContractError, match="response shape changed"):
        capture_code_vocabulary(plan, services)

    connection.rollback()
    assert services.store.object_count == 1
    with connection.cursor() as cursor:
        cursor.execute(
            "select status from ingest.source_release where source_release_id = %s",
            (str(plan.source_release_id),),
        )
        assert cursor.fetchone()[0] == "planned"
        cursor.execute(
            "select count(*) from ingest.raw_observation where run_id = %s",
            (str(plan.run_id),),
        )
        assert cursor.fetchone()[0] == 1
    connection.rollback()


def test_투영이_보존된_원본을_다시_읽어_이름과_유효기간을_앉힌다(connection) -> None:
    services = _services(connection, FIXTURE.read_bytes())
    plan = _plan()
    captured = capture_code_vocabulary(plan, services)

    with connection.cursor() as cursor:
        projected = project_code_vocabulary_observation(
            cursor,
            store=services.store,
            source_release_id=plan.source_release_id,
            observation_id=captured.observation_id,
            parser_version=PARSER_VERSION,
            projected_at=CAPTURED_AT,
        )

        assert projected.entry_count == captured.entry_count
        assert projected.inserted_labels == captured.entry_count
        assert projected.deactivated_code_values == 0
        assert _label(cursor, AUCTION_LOCATION_SIDO.namespace, "15") == ("경남", True)
        assert _label(cursor, AUCTION_LOCATION_SIGUNGU.namespace, "653") == ("김해시", True)
        assert _label(cursor, ATTEMPT_STATUS.namespace, "007") == ("낙찰", True)
        assert _label(cursor, ORGANIZATION_TYPE.namespace, "010") == ("학교", True)
        # 시군구 셋이 각자 소스가 말한 시도에 `parent`로 잇긴다. 근거는 이 코드목록 관측이다.
        assert projected.inserted_mappings == 3
        assert _parents(cursor) == [("1", "1"), ("653", "15"), ("654", "15")]
        cursor.execute(
            "select distinct evidence_observation_id, status from core.code_mapping where relation = %s",
            (PARENT_RELATION,),
        )
        assert cursor.fetchall() == [(captured.observation_id, "observed")]

        cursor.execute(
            """
            select value.valid_from, value.valid_to
            from core.code_value value
            join core.code_scheme scheme using (code_scheme_id)
            where scheme.namespace = %s and value.code = %s
            """,
            (AUCTION_LOCATION_SIDO.namespace, "15"),
        )
        valid_from, valid_to = cursor.fetchone()
        assert valid_from.year == 1899
        assert valid_to.year == 9999

        # 라벨의 증거는 이 코드목록 관측이다. 공고 관측을 빌려 쓰지 않는다.
        cursor.execute(
            """
            select distinct label.observation_id
            from core.code_label_observation label
            join core.code_value value using (code_value_id)
            join core.code_scheme scheme using (code_scheme_id)
            where scheme.namespace = %s
            """,
            (ORGANIZATION_TYPE.namespace,),
        )
        assert [row[0] for row in cursor.fetchall()] == [captured.observation_id]
    connection.rollback()


def test_같은_관측을_두_번_투영해도_행이_늘지_않는다(connection) -> None:
    services = _services(connection, FIXTURE.read_bytes())
    plan = _plan()
    captured = capture_code_vocabulary(plan, services)

    with connection.cursor() as cursor:
        first = project_code_vocabulary_observation(
            cursor,
            store=services.store,
            source_release_id=plan.source_release_id,
            observation_id=captured.observation_id,
            parser_version=PARSER_VERSION,
            projected_at=CAPTURED_AT,
        )
        again = project_code_vocabulary_observation(
            cursor,
            store=services.store,
            source_release_id=plan.source_release_id,
            observation_id=captured.observation_id,
            parser_version=PARSER_VERSION,
            projected_at=CAPTURED_AT,
        )

        assert first.inserted_labels == captured.entry_count
        assert again.inserted_labels == 0
        assert again.inserted_code_values == 0
        assert first.inserted_mappings == 3
        assert again.inserted_mappings == 0
        cursor.execute(
            """
            select count(*) from core.code_label_observation label
            join core.code_value value using (code_value_id)
            join core.code_scheme scheme using (code_scheme_id)
            where scheme.namespace = %s
            """,
            (AUCTION_LOCATION_SIDO.namespace,),
        )
        assert cursor.fetchone()[0] == 5
    connection.rollback()


def test_어휘_적재가_지역_축_전환을_촉발하지_않는다(connection) -> None:
    """mart 지역 축은 선언한 체계에 code release가 있을 때만 번역을 강제한다.

    시도와 시군구는 서로 다른 체계라 어느 한쪽을 선언한 build가 강제 모드로 들어가면 다른 쪽 열이
    전부 "체계 밖 코드"가 되어 mart 빌드가 멈춘다. 이름을 채우는 일이 그 전환을 촉발하면 안 된다.
    """
    services = _services(connection, FIXTURE.read_bytes())
    plan = _plan()
    captured = capture_code_vocabulary(plan, services)

    with connection.cursor() as cursor:
        project_code_vocabulary_observation(
            cursor,
            store=services.store,
            source_release_id=plan.source_release_id,
            observation_id=captured.observation_id,
            parser_version=PARSER_VERSION,
            projected_at=CAPTURED_AT,
        )
        cursor.execute(
            """
            select count(*) from core.code_release release
            join core.code_scheme scheme using (code_scheme_id)
            where scheme.namespace in (%s, %s)
            """,
            (AUCTION_LOCATION_SIDO.namespace, AUCTION_LOCATION_SIGUNGU.namespace),
        )
        assert cursor.fetchone()[0] == 0
    connection.rollback()
