"""모듈 책임: mart 빌드의 멱등 개시·검증·원자적 활성화·실패 내구화를 PostgreSQL에서 구현한다.

계산 규칙은 mart별 빌더가 갖고 여기에는 상태만 있다. 전환이 한 트랜잭션의 UPDATE 둘로 끝나는 이유와
동시 전환이 끊기는 이유는 `mart.build`의 partial unique index에 있다(ADR 0034).
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any
from uuid import UUID

from eatbid.mart.build_coverage import fill_build_coverage
from eatbid.mart.models import MartBuildPlan, MartName, OpenedMartBuild
from eatbid.mart.region_axis import assert_build_region_scheme
from eatbid.mart.repository import MartBuildContractError

# build_id FK를 가진 표의 이름이다. 재개할 때 이전 행을 지우는 대상이며, 새 mart를 더하면 여기와
# `MartName`이 함께 움직인다.
MART_TABLES: Mapping[MartName, str] = {
    "org_round_summary": "mart.org_round_summary",
    "win_rate_distribution_monthly": "mart.win_rate_distribution_monthly",
    "open_auction_snapshot": "mart.open_auction_snapshot",
}

# 물린 build의 행을 얼마나 오래 남기는가. 참여 수 추이가 지난 관측점을 읽는 mart만 길게 잡는다.
RETENTION_DAYS: Mapping[MartName, int] = {
    "org_round_summary": 1,
    "win_rate_distribution_monthly": 1,
    "open_auction_snapshot": 7,
}

_FIND_BUILD_SQL = """
select build_id, status, row_count
  from mart.build
 where mart_name = %(mart_name)s
   and calc_version = %(calc_version)s
   and source_release_id = %(source_release_id)s
   and publication_id is not distinct from %(publication_id)s
 for update
"""

_INSERT_BUILD_SQL = """
insert into mart.build
  (mart_name, source_release_id, publication_id, calc_version, builder_version,
   region_scheme, status, as_of, started_at)
values (%(mart_name)s, %(source_release_id)s, %(publication_id)s, %(calc_version)s,
        %(builder_version)s, %(region_scheme)s, 'building', %(as_of)s, %(started_at)s)
returning build_id
"""

_PUBLICATION_RECORD_TYPES_SQL = """
select distinct record.record_type
  from ingest.publication_record as member
  join ingest.normalized_record as record
    on record.normalized_record_id = member.normalized_record_id
 where member.publication_id = %(publication_id)s
"""


class PsycopgMartBuildRepository:
    """왜 실패 기록만 별도 연결인가: 빌드 트랜잭션이 되감기면 실패 사실까지 함께 사라진다.

    core 투영 repository가 같은 이유로 같은 모양을 쓴다.
    """

    def __init__(
        self,
        connection: Any,
        connect: Callable[[], Any],
        builders: Mapping[MartName, Callable[..., int]],
    ) -> None:
        self._connection = connection
        self._connect = connect
        self._builders = builders

    def open_build(self, plan: MartBuildPlan) -> OpenedMartBuild:
        key = {
            "mart_name": plan.mart_name,
            "calc_version": plan.calc_version,
            "source_release_id": plan.source_release_id,
            "publication_id": plan.publication_id,
        }
        with self._connection.cursor() as cursor:
            cursor.execute(_FIND_BUILD_SQL, key)
            existing = cursor.fetchone()
            if existing is not None:
                opened = self._reopen(cursor, plan, existing)
                if opened is not None:
                    self._connection.commit()
                    return opened
            cursor.execute(
                _INSERT_BUILD_SQL,
                {
                    **key,
                    "builder_version": plan.builder_version,
                    "region_scheme": plan.region_scheme,
                    "as_of": plan.as_of,
                    "started_at": plan.started_at,
                },
            )
            created = cursor.fetchone()
        if created is None:
            raise MartBuildContractError("mart build insertion returned no identity")
        self._connection.commit()
        return OpenedMartBuild(build_id=int(created[0]), status="building", row_count=None)

    def _reopen(
        self, cursor: Any, plan: MartBuildPlan, existing: tuple[Any, ...]
    ) -> OpenedMartBuild | None:
        build_id, status, row_count = int(existing[0]), str(existing[1]), existing[2]
        if status in {"active", "verified"}:
            # 같은 봉인된 입력·같은 계산 규칙의 결과가 이미 있다. 다시 세지 않는다.
            return OpenedMartBuild(
                build_id=build_id,
                status="active" if status == "active" else "verified",
                row_count=None if row_count is None else int(row_count),
            )
        if status == "superseded":
            # 이미 발표됐다가 더 새 build로 물린 입력이다. 되살리면 화면이 과거로 돌아간다.
            raise MartBuildContractError(
                f"superseded mart build cannot be rebuilt [mart={plan.mart_name}]"
            )
        cursor.execute(
            f"delete from {MART_TABLES[plan.mart_name]} where build_id = %s",
            (build_id,),
        )
        # 보유율 행도 이 build의 산출물이다. 남겨 두면 재개한 빌드가 같은 grain을 다시 넣다 끊긴다.
        cursor.execute(
            "delete from mart.build_coverage where build_id = %s", (build_id,)
        )
        if status == "building":
            return OpenedMartBuild(build_id=build_id, status="building", row_count=None)
        # 실패한 build는 `failed → building` 전이가 없으므로 행과 함께 지우고 새로 연다.
        cursor.execute("delete from mart.build where build_id = %s", (build_id,))
        return None

    def fill_build(self, plan: MartBuildPlan, build_id: int) -> int:
        builder = self._builders.get(plan.mart_name)
        if builder is None:
            raise MartBuildContractError(f"mart has no builder [mart={plan.mart_name}]")
        row_count = builder(self._connection, plan=plan, build_id=build_id)
        # 보유율은 같은 build의 사실이므로 같은 트랜잭션에서 쓴다. 지표만 발표되고 그 지표를
        # 어디까지 믿어도 되는지가 빠지면 화면이 모르는 것을 아는 척한다(AGENTS 3).
        fill_build_coverage(self._connection, plan=plan, build_id=build_id)
        self._connection.commit()
        return row_count

    def verify_build(self, plan: MartBuildPlan, build_id: int, row_count: int) -> None:
        """행 수를 고정하기 전에 실제로 저장된 행을 다시 센다.

        빌더가 돌려준 수를 그대로 믿으면 부분 적재가 "검증됨"으로 통과하고, 그 build가 활성이 되는
        순간 화면이 조용히 적은 표본을 본다(ADR 0010).

        지역 축도 같은 자리에서 확인한다. 한 build는 한 체계이며, 선언한 체계 밖의 코드를 실은 build를
        올리면 화면이 한 사다리에서 두 체계의 지역을 함께 읽는다(설계 §6 전환의 불변식).
        """
        assert_build_region_scheme(self._connection, plan=plan, build_id=build_id)
        with self._connection.cursor() as cursor:
            cursor.execute(
                f"select count(*) from {MART_TABLES[plan.mart_name]} where build_id = %s",
                (build_id,),
            )
            stored = cursor.fetchone()
            if stored is None or int(stored[0]) != row_count:
                self._connection.rollback()
                raise MartBuildContractError(
                    f"mart build row count differs from stored rows [build_id={build_id}]"
                )
            cursor.execute(
                """
                update mart.build
                   set status = 'verified', computed_at = %s, row_count = %s
                 where build_id = %s and status = 'building'
                """,
                (plan.computed_at, row_count, build_id),
            )
            if cursor.rowcount != 1:
                self._connection.rollback()
                raise MartBuildContractError(
                    f"mart build was not building when verified [build_id={build_id}]"
                )
        self._connection.commit()

    def activate_build(self, plan: MartBuildPlan, build_id: int) -> None:
        retention = RETENTION_DAYS.get(plan.mart_name, 1)
        with self._connection.cursor() as cursor:
            cursor.execute(
                """
                update mart.build
                   set status = 'superseded', superseded_at = %s,
                       retain_until = %s + make_interval(days => %s)
                 where mart_name = %s and status = 'active'
                """,
                (plan.computed_at, plan.computed_at, retention, plan.mart_name),
            )
            cursor.execute(
                """
                update mart.build set status = 'active', activated_at = %s
                 where build_id = %s and status = 'verified'
                """,
                (plan.computed_at, build_id),
            )
            if cursor.rowcount != 1:
                raise MartBuildContractError(
                    f"mart build was not verified when activated [build_id={build_id}]"
                )
        self._connection.commit()

    def fail_build(self, build_id: int, failure_category: str) -> None:
        connection = self._connect()
        try:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    update mart.build
                       set status = 'failed', failure_category = %s
                     where build_id = %s and status = 'building'
                    """,
                    (failure_category, build_id),
                )
            connection.commit()
        finally:
            connection.close()

    def publication_marts(self, publication_id: UUID) -> tuple[str, ...]:
        """그 발행이 실은 record type을 돌려준다. 영향 범위는 호출부가 이 이름으로 고른다."""
        with self._connection.cursor() as cursor:
            cursor.execute(
                _PUBLICATION_RECORD_TYPES_SQL, {"publication_id": publication_id}
            )
            return tuple(str(row[0]) for row in cursor.fetchall())

