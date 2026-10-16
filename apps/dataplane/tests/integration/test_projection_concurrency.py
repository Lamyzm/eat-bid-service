"""발행 mutex 없이 두 투영이 동시에 돌 때 core 공유 행에서 서로 막지 않고, 새 기관을 함께 만들어도 하나로 모이는지
실제 PostgreSQL에서 확인한다(EAT-366, ADR 0070).

2026-10-16 08:25 재처리 회차가 2만 건을 한 거래로 쓰는 동안 발행 mutex를 58분 쥐어 아침 개찰 결과 반영이 멈췄다. mutex를
빼도 투영이 코드값·기관·업체·공고 행을 `FOR NO KEY UPDATE`로 잠그면 같은 잠금끼리 막혀 DB에서 똑같이 줄을 선다. 그래서
긴 거래를 실제 투영으로 열어 둔 채 다른 발행이 같은 공유 행을 쓰는지를 본다.
"""

from __future__ import annotations

import threading
from collections.abc import Iterator
from typing import Any
from uuid import UUID

import psycopg
import pytest

from eatbid.core.postgres_repository import PsycopgCanonicalProjectionRepository
from eatbid.pipeline.project import build_projection, project_publication

from .conftest import MigratedDatabase, PipelineServices
from .test_normalize_validate import BUILD_SHA
from .test_project import ACTIVATED_AT
from .test_project_v2 import ROSTER_FIXTURE, publish_v2_observation

# 막힘을 판정하는 시간이다. 막히지 않는 투영은 이보다 훨씬 빨리 끝나고, 막히는 쪽은 이 시간 뒤에
# `LockNotAvailable`로 끝나 시험이 매달리지 않는다.
_LOCK_TIMEOUT = "5s"


@pytest.fixture
def long_connection(migrated_db: MigratedDatabase) -> Iterator[psycopg.Connection[Any]]:
    connection = migrated_db.connect()
    try:
        yield connection
    finally:
        connection.rollback()
        connection.close()


@pytest.fixture
def bounded_services(pipeline_services: PipelineServices) -> Iterator[PipelineServices]:
    pipeline_services.connection.execute(f"set lock_timeout = '{_LOCK_TIMEOUT}'")
    pipeline_services.connection.commit()
    try:
        yield pipeline_services
    finally:
        pipeline_services.connection.rollback()
        pipeline_services.connection.execute("reset lock_timeout")
        pipeline_services.connection.commit()


def _project(services: PipelineServices, publication_id: UUID) -> object:
    return project_publication(
        publication_id=publication_id,
        projector_version=BUILD_SHA,
        activated_at=ACTIVATED_AT,
        repository=services.projection_repository,
    )


def _project_without_commit(
    connection: psycopg.Connection[Any],
    migrated_db: MigratedDatabase,
    cursor: psycopg.Cursor[Any],
    publication_id: UUID,
) -> None:
    """실제 투영을 돌리되 거래를 닫지 않는다. 재처리가 2만 건을 쓰는 동안 쥐고 있는 잠금과 같은 잠금이 남는다."""
    repository = PsycopgCanonicalProjectionRepository(connection, migrated_db.connect)
    # 공개 입구는 거래를 스스로 닫는다. 긴 거래를 흉내 내려면 시험이 거래 경계를 쥐어야 해서 안쪽을 부른다.
    repository._project_locked(
        cursor,
        publication_id=publication_id,
        projector_version=BUILD_SHA,
        activated_at=ACTIVATED_AT,
        projection_factory=build_projection,
        require_published=False,
    )


def test_긴_투영이_거래를_열어_둔_동안_같은_공유_행을_쓰는_다른_발행이_막히지_않는다(
    migrated_db: MigratedDatabase,
    bounded_services: PipelineServices,
    long_connection: psycopg.Connection[Any],
) -> None:
    # 공유 행(학교·업체·코드값)이 이미 있는 상태에서 시작한다. 운영의 재처리와 정시 수집이 그렇다.
    seed, _ = publish_v2_observation(bounded_services, ROSTER_FIXTURE.read_bytes())
    _project(bounded_services, seed)
    long_publication, _ = publish_v2_observation(bounded_services, ROSTER_FIXTURE.read_bytes())
    live_publication, _ = publish_v2_observation(bounded_services, ROSTER_FIXTURE.read_bytes())

    with long_connection.transaction(force_rollback=True), long_connection.cursor() as cursor:
        _project_without_commit(long_connection, migrated_db, cursor, long_publication)
        # 긴 거래가 같은 학교·업체·코드값을 잠근 채 열려 있다. 예전 `FOR NO KEY UPDATE`면 여기서 5초 뒤에 막혀 끝난다.
        result = _project(bounded_services, live_publication)

    assert result is not None
    status = bounded_services.connection.execute(
        "select status from ingest.publication where publication_id = %s", (live_publication,)
    ).fetchone()
    bounded_services.connection.commit()
    assert status == ("published",)


def test_공유_행을_고치는_잠금에는_여전히_막혀_시험이_그_행을_실제로_지나는지_가른다(
    bounded_services: PipelineServices,
    long_connection: psycopg.Connection[Any],
) -> None:
    """왜: 위 시험이 통과하는 것이 잠금 방식 덕인지, 투영이 애초에 그 행을 건드리지 않아서인지 가른다. 기관 행을
    고치는 잠금(`FOR UPDATE`)을 다른 거래가 쥐면 참조 잠금도 기다려야 한다."""
    seed, _ = publish_v2_observation(bounded_services, ROSTER_FIXTURE.read_bytes())
    _project(bounded_services, seed)
    blocked, _ = publish_v2_observation(bounded_services, ROSTER_FIXTURE.read_bytes())
    organization_id = bounded_services.connection.execute(
        """
        select purchaser.organization_id
          from core.auction_organization as purchaser
          join core.auction_revision as revision using (auction_revision_id)
          join ingest.publication_record as record using (normalized_record_id)
         where record.publication_id = %s and purchaser.role = 'purchaser'
        """,
        (seed,),
    ).fetchone()
    bounded_services.connection.commit()
    assert organization_id is not None

    with long_connection.transaction(force_rollback=True):
        long_connection.execute(
            "select 1 from core.organization where organization_id = %s for update", organization_id
        )
        with pytest.raises(psycopg.errors.LockNotAvailable):
            _project(bounded_services, blocked)


def test_두_투영이_같은_새_기관을_함께_만들면_하나로_모인다(
    migrated_db: MigratedDatabase,
    bounded_services: PipelineServices,
    long_connection: psycopg.Connection[Any],
) -> None:
    """왜: 기관 행에는 자연 키가 없어 mutex가 없으면 두 투영이 같은 새 기관을 둘 만들거나 식별자 unique에 부딪힌다.
    새 기관을 만드는 쪽은 그 기관 코드 하나로 줄을 서고, 뒤 투영은 앞 투영이 끝난 뒤 그 기관을 다시 찾는다."""
    body = ROSTER_FIXTURE.read_bytes().replace(
        b'<Col id="PURR_CD">153045</Col>', b'<Col id="PURR_CD">991366</Col>'
    )
    # 기관 코드값은 이미 있고 기관 행만 없는 상태다(기준정보 투영이 코드를 먼저 앉힌 경우). 코드값까지 새것이면 그
    # insert에서 이미 줄이 서서 기관을 만드는 자리의 경합을 시험하지 못한다.
    bounded_services.connection.execute(
        """
        insert into core.code_value (code_scheme_id, code)
        select code_scheme_id, '991366' from core.code_scheme where namespace = 'eat:organization'
        """
    )
    bounded_services.connection.commit()
    first, _ = publish_v2_observation(bounded_services, body)
    second, _ = publish_v2_observation(bounded_services, body)
    outcome: dict[str, object] = {}

    def project_second() -> None:
        connection = migrated_db.connect()
        try:
            repository = PsycopgCanonicalProjectionRepository(connection, migrated_db.connect)
            outcome["result"] = project_publication(
                publication_id=second,
                projector_version=BUILD_SHA,
                activated_at=ACTIVATED_AT,
                repository=repository,
            )
        except Exception as error:  # noqa: BLE001 - 스레드의 실패를 본 시험에 옮긴다
            outcome["error"] = error
        finally:
            connection.close()

    with long_connection.transaction(), long_connection.cursor() as cursor:
        _project_without_commit(long_connection, migrated_db, cursor, first)
        worker = threading.Thread(target=project_second)
        worker.start()
        # 뒤 투영은 새 기관 코드의 줄에서 기다린다. 앞 거래가 끝나기 전에는 끝나지 않아야 한다.
        worker.join(timeout=3)
        assert worker.is_alive(), "앞 투영이 새 기관을 만드는 동안 뒤 투영이 기다리지 않았다"
    worker.join(timeout=60)

    assert "error" not in outcome, outcome.get("error")
    rows = bounded_services.connection.execute(
        """
        select count(distinct identifier.organization_id), count(*)
          from core.organization_identifier as identifier
          join core.code_value as value using (code_value_id)
         where value.code = '991366'
        """
    ).fetchone()
    purchasers = bounded_services.connection.execute(
        """
        select count(distinct purchaser.organization_id)
          from core.auction_organization as purchaser
          join core.auction_revision as revision using (auction_revision_id)
          join ingest.publication_record as record using (normalized_record_id)
         where record.publication_id = any(%s) and purchaser.role = 'purchaser'
        """,
        ([first, second],),
    ).fetchone()
    bounded_services.connection.commit()
    assert rows == (1, 1)
    assert purchasers == (1,)


def test_두_투영이_같은_새_업체_계정을_함께_만들면_하나로_모인다(
    migrated_db: MigratedDatabase,
    bounded_services: PipelineServices,
    long_connection: psycopg.Connection[Any],
) -> None:
    """왜: 업체 계정 행은 mutex가 없으면 두 투영이 같은 (계정, 업체) 짝을 함께 넣다 한쪽이 unique에 부딪힌다. 짝
    unique로 경합을 풀고 진 쪽은 이긴 쪽 행을 다시 찾아야 한다."""
    # 업체(사업자번호)는 이미 있고 계정 코드값도 있지만 그 짝은 아직 없는 상태다. 그래야 두 투영이 계정 행을 넣는
    # 자리에서 만난다.
    seed, _ = publish_v2_observation(bounded_services, ROSTER_FIXTURE.read_bytes())
    _project(bounded_services, seed)
    body = ROSTER_FIXTURE.read_bytes()
    for ordinal in range(7):
        body = body.replace(
            f'<Col id="SHIPPER_CD">20000{ordinal}</Col>'.encode(),
            f'<Col id="SHIPPER_CD">70000{ordinal}</Col>'.encode(),
        )
        bounded_services.connection.execute(
            """
            insert into core.code_value (code_scheme_id, code)
            select code_scheme_id, %s from core.code_scheme where namespace = 'eat:supplier-account'
            """,
            (f"70000{ordinal}",),
        )
    bounded_services.connection.commit()
    first, _ = publish_v2_observation(bounded_services, body)
    second, _ = publish_v2_observation(bounded_services, body)
    outcome: dict[str, object] = {}

    def project_second() -> None:
        connection = migrated_db.connect()
        try:
            repository = PsycopgCanonicalProjectionRepository(connection, migrated_db.connect)
            outcome["result"] = project_publication(
                publication_id=second,
                projector_version=BUILD_SHA,
                activated_at=ACTIVATED_AT,
                repository=repository,
            )
        except Exception as error:  # noqa: BLE001 - 스레드의 실패를 본 시험에 옮긴다
            outcome["error"] = error
        finally:
            connection.close()

    with long_connection.transaction(), long_connection.cursor() as cursor:
        _project_without_commit(long_connection, migrated_db, cursor, first)
        worker = threading.Thread(target=project_second)
        worker.start()
        worker.join(timeout=3)
        assert worker.is_alive(), "앞 투영이 새 계정 짝을 넣는 동안 뒤 투영이 기다리지 않았다"
    worker.join(timeout=60)

    assert "error" not in outcome, outcome.get("error")
    accounts = bounded_services.connection.execute(
        """
        select count(*)
          from core.source_supplier_account as account
          join core.code_value as value on value.code_value_id = account.account_code_value_id
         where value.code like '70000_'
        """
    ).fetchone()
    bounded_services.connection.commit()
    assert accounts == (7,)
