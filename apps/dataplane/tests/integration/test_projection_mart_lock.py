"""발행의 core 행 잠금과 mart 빌드의 외래키 검사가 서로를 막지 않는지 실제 PostgreSQL에서 확인한다.

운영 사고(2026-09-28 01:53 UTC, EAT-286)의 순서를 두 연결로 그대로 밟는다.

1. 발행이 기관 A를 잠근다.
2. mart 빌드가 기관 B를 가리키는 행을 넣는다 — PostgreSQL이 B에 `FOR KEY SHARE`를 건다.
3. 발행이 기관 B를 잠근다.
4. mart 빌드가 기관 A를 가리키는 행을 넣는다.

`FOR UPDATE`면 3에서 발행이 mart를 기다리고 4에서 mart가 발행을 기다려 교착이 된다. 교착 판정을
기다리지 않도록 `lock_timeout`을 짧게 두고 3에서 막히는지를 본다.
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime
from uuid import uuid4

import psycopg
import pytest

from .conftest import MigratedDatabase, PipelineServices
from .mart_seed import code_value, seed_organization
from .mart_support import create_source_release, mart_plan, open_build

# 막힘을 판정하는 시간이다. 막히지 않는 잠금은 즉시 돌아오므로 넉넉할 필요가 없고, 막히는 쪽은 이 시간
# 뒤에 `LockNotAvailable`로 끝나 시험이 매달리지 않는다.
_LOCK_TIMEOUT = "2s"

# 발행이 기관 행을 잡는 모양이다. 실제 `_resolve_organization`은 식별자 표와 함께 잠그지만 충돌은 기관
# 행에서 난다(운영 로그 `while locking tuple ... in relation "organization"`).
_LOCK_ORGANIZATION = "select organization_id from core.organization where organization_id = %s {mode}"


@pytest.fixture
def two_connections(
    migrated_db: MigratedDatabase,
) -> Iterator[tuple[psycopg.Connection[tuple[object, ...]], psycopg.Connection[tuple[object, ...]]]]:
    projection = migrated_db.connect()
    mart = migrated_db.connect()
    for connection in (projection, mart):
        connection.execute(f"set lock_timeout = '{_LOCK_TIMEOUT}'")
        connection.commit()
    try:
        yield projection, mart
    finally:
        # 막힌 채 끝난 트랜잭션을 되돌려야 다음 시험이 잠금을 물려받지 않는다.
        for connection in (projection, mart):
            connection.rollback()
            connection.close()


def _seed(services: PipelineServices) -> tuple[int, int, int, int]:
    organization_a = seed_organization(services, "잠금 시험 기관 A")
    organization_b = seed_organization(services, "잠금 시험 기관 B")
    build_id = open_build(
        services,
        mart_plan(create_source_release(services), mart_name="win_rate_distribution_monthly"),
    )
    award_method = code_value(services, namespace="eat:award-method", code="003")
    return organization_a, organization_b, build_id, award_method


def _insert_mart_row(
    connection: psycopg.Connection[tuple[object, ...]],
    *,
    build_id: int,
    organization_id: int,
    award_method: int,
    bin_lower: str,
) -> None:
    connection.execute(
        """
        insert into mart.win_rate_distribution_monthly
          (build_id, scope, organization_id, floor_rate, award_method_code_value_id,
           month_kst, bin_lower, bin_width, attempt_count)
        values (%s, 'organization', %s, 90.000, %s, '2026-09-01', %s, 0.100, 1)
        """,
        (build_id, organization_id, award_method, bin_lower),
    )


def test_FOR_NO_KEY_UPDATE_발행_잠금은_mart_외래키_검사와_엇갈려도_막히지_않는다(
    pipeline_services: PipelineServices,
    two_connections: tuple[psycopg.Connection[tuple[object, ...]], psycopg.Connection[tuple[object, ...]]],
) -> None:
    organization_a, organization_b, build_id, award_method = _seed(pipeline_services)
    projection, mart = two_connections
    lock = _LOCK_ORGANIZATION.format(mode="for no key update")

    projection.execute(lock, (organization_a,))
    _insert_mart_row(mart, build_id=build_id, organization_id=organization_b,
                     award_method=award_method, bin_lower="99.000")
    # 사고에서 교착의 첫 고리였던 자리다. mart의 `FOR KEY SHARE`와 충돌하지 않으므로 기다리지 않는다.
    projection.execute(lock, (organization_b,))
    _insert_mart_row(mart, build_id=build_id, organization_id=organization_a,
                     award_method=award_method, bin_lower="99.100")

    projection.commit()
    mart.commit()


def test_옛_FOR_UPDATE_발행_잠금은_같은_순서에서_mart에_막힌다(
    pipeline_services: PipelineServices,
    two_connections: tuple[psycopg.Connection[tuple[object, ...]], psycopg.Connection[tuple[object, ...]]],
) -> None:
    """왜: 위 시험이 통과하는 것이 잠금 방식 덕인지 시험 순서가 애초에 충돌을 만들지 못해서인지 가른다.
    같은 순서에서 옛 잠금은 반드시 막혀야 한다."""
    organization_a, organization_b, build_id, award_method = _seed(pipeline_services)
    projection, mart = two_connections
    lock = _LOCK_ORGANIZATION.format(mode="for update")

    projection.execute(lock, (organization_a,))
    _insert_mart_row(mart, build_id=build_id, organization_id=organization_b,
                     award_method=award_method, bin_lower="99.000")
    with pytest.raises(psycopg.errors.LockNotAvailable):
        projection.execute(lock, (organization_b,))


def _deadlocking_projection(
    services: PipelineServices, monkeypatch: pytest.MonkeyPatch, *, deadlocks: int
) -> list[bool]:
    """투영 본체를 앞의 `deadlocks`번은 교착으로 끝나게 바꿔 끼운다. 부를 때마다 그때 트랜잭션 안이었는지를
    적어, 매 시도가 새 트랜잭션에서 도는지 시험이 확인할 수 있게 한다."""
    calls: list[bool] = []
    connection = services.projection_repository._connection

    def project_locked(*_args: object, **_kwargs: object) -> str:
        calls.append(connection.info.transaction_status == psycopg.pq.TransactionStatus.INTRANS)
        if len(calls) <= deadlocks:
            raise psycopg.errors.DeadlockDetected("deadlock detected")
        return "projected"

    monkeypatch.setattr(services.projection_repository, "_project_locked", project_locked)
    return calls


def _project(services: PipelineServices) -> object:
    return services.projection_repository.project_publication(
        publication_id=uuid4(),
        projector_version="a" * 40,
        activated_at=datetime(2026, 9, 28, 1, 26, tzinfo=UTC),
        projection_factory=lambda *_: None,  # type: ignore[arg-type,return-value]
    )


def test_투영은_교착으로_되돌려지면_새_트랜잭션에서_다시_해_끝낸다(
    pipeline_services: PipelineServices, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls = _deadlocking_projection(pipeline_services, monkeypatch, deadlocks=2)

    assert _project(pipeline_services) == "projected"
    # 세 번 불렸고 매번 트랜잭션 안이었다 — 되돌려진 트랜잭션을 이어 쓰지 않고 새로 열었다.
    assert calls == [True, True, True]
    assert (
        pipeline_services.projection_repository._connection.info.transaction_status
        == psycopg.pq.TransactionStatus.IDLE
    )


def test_투영이_끝까지_교착하면_실패로_표시하지_않고_그대로_올린다(
    pipeline_services: PipelineServices, monkeypatch: pytest.MonkeyPatch
) -> None:
    """왜: 거듭된 교착은 일시 경합이 아니라 잠금 순서가 틀린 것이라 숨기면 안 된다. 그래도 발행을 계약
    위반으로 얼리지는 않는다 — 검증된 발행은 다음 실행이 그대로 다시 투영할 수 있어야 한다."""
    calls = _deadlocking_projection(pipeline_services, monkeypatch, deadlocks=99)
    marked: list[object] = []
    monkeypatch.setattr(
        pipeline_services.projection_repository,
        "_mark_projection_failed",
        lambda **kwargs: marked.append(kwargs),
    )

    with pytest.raises(psycopg.errors.DeadlockDetected):
        _project(pipeline_services)
    assert len(calls) == 3
    assert marked == []
