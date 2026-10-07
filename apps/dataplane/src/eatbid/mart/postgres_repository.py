"""모듈 책임: mart 빌드의 멱등 개시·검증·원자적 활성화·실패 내구화를 PostgreSQL에서 구현한다.

계산 규칙은 mart별 빌더가 갖고 여기에는 상태만 있다. 전환이 한 트랜잭션의 UPDATE 둘로 끝나는 이유와
동시 전환이 끊기는 이유는 `mart.build`의 partial unique index에 있다(ADR 0034).
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from datetime import timedelta
from typing import Any
from uuid import UUID

from eatbid.mart.build_coverage import fill_build_coverage
from eatbid.mart.build_exclusion import fill_build_exclusions
from eatbid.mart.models import MartBuildPlan, MartName, OpenedMartBuild
from eatbid.mart.region_axis import assert_build_region_scheme
from eatbid.mart.repository import MartBuildContractError, MartTransactionScopeError
from eatbid.transaction_scope import require_idle, rollback_leftover

# build_id FK를 가진 표의 이름이다. 재개할 때 이전 행을 지우는 대상이며, 새 mart를 더하면 여기와
# `MartName`이 함께 움직인다.
MART_TABLES: Mapping[MartName, str] = {
    "org_round_summary": "mart.org_round_summary",
    "win_rate_distribution_monthly": "mart.win_rate_distribution_monthly",
    "open_auction_snapshot": "mart.open_auction_snapshot",
}

# 어느 mart든 build마다 함께 적는 부속 표(보유율·제외)다. 재개·회수가 build의 행을 지울 때 함께 지운다 — 하나라도
# 빠지면 재개한 build가 같은 grain을 다시 넣다 끊기거나 남은 부속 행의 FK가 build 삭제를 막는다. 쓰기 지도 검사가
# 표 이름을 리터럴로 읽으므로 문장을 그대로 적는다.
_BUILD_SIDE_DELETES: tuple[str, ...] = (
    "delete from mart.build_coverage where build_id = %s",
    "delete from mart.build_exclusion_month where build_id = %s",
    "delete from mart.build_stale_auction where build_id = %s",
)

# 물린 build의 행을 얼마나 오래 남기는가. 참여 수 추이가 지난 관측점을 읽는 mart만 길게 잡는다.
#
# 회차 요약·분포의 물린 build는 아무도 읽지 않는다(지난 build를 읽는 것은 참여 수 추이의 스냅샷뿐이다).
# 그래도 0이 아닌 이유는 전환 직전에 활성 build id를 읽은 요청이 행을 다 읽을 시간이다. 예전에는 1일이었는데,
# 정시 수집이 30분마다 build를 물리고 백필로 한 벌이 열 배쯤 커지자(회차 요약 87만 행) 1일치 사본 40여 벌이
# 55GB를 들고 노드 디스크를 채웠다(2026-10-07, EAT-303). 3시간이면 사본은 대여섯 벌이다.
DEFAULT_RETENTION = timedelta(days=1)
RETENTION: Mapping[MartName, timedelta] = {
    "org_round_summary": timedelta(hours=3),
    "win_rate_distribution_monthly": timedelta(hours=3),
    "open_auction_snapshot": timedelta(days=7),
}

# 맨 `FOR UPDATE`가 맞다. core·ingest가 `FOR NO KEY UPDATE`로 내린 이유(EAT-286)는 mart 행을 넣을 때
# 걸리는 `FOR KEY SHARE`와 충돌하지 않기 위해서였다. 여기서 잠근 build 행은 `_reopen`이 지울 수 있고
# 지우기는 어차피 `FOR UPDATE` 수준 잠금을 요구하므로 약하게 잡아도 얻는 것이 없다. 같은 멱등 키의 동시
# 개시를 이 행에서 줄 세우는 것이 의도이며, 이 행을 `FOR KEY SHARE`로 가리키는 것은 같은 build를 채우는
# 자기 자신뿐이다(`tests/unit/test_row_lock_mode.py`가 이 경계를 고정한다).
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

_RUN_MODE_SQL = "select mode from ingest.run where run_id = %(run_id)s"

# 채우기의 실제 시작·끝이다. `now()`는 트랜잭션 시작 시각에 멈춰 있어 한 트랜잭션 안의 두 값이 같아진다 —
# 흐르는 `clock_timestamp()`여야 mart마다 계산에 걸린 시간이 남는다(EAT-300, ADR 0060). 시작은 읽어 두기만 하고
# 두 값을 끝에 한 번에 쓴다. 시작에서 build 행을 고치면 채우는 수십 분 내내 그 행에 쓰기 잠금이 걸린다. 끊긴 채우기는
# 되감기므로 끝이 null인 building build가 "채우다 끊겼다"의 흔적이 된다.
_FILL_CLOCK_SQL = "select clock_timestamp()"

_RECORD_FILL_SQL = """
update mart.build
   set fill_started_at = %s, fill_finished_at = clock_timestamp()
 where build_id = %s and status = 'building'
"""


class PsycopgMartBuildRepository:
    """왜 실패 기록만 별도 연결인가: 빌드 트랜잭션이 되감기면 실패 사실까지 함께 사라진다.

    core 투영 repository가 같은 이유로 같은 모양을 쓴다.

    트랜잭션 소유권(ADR 0059): 모든 메서드는 연결이 IDLE인지 먼저 확인하고, 읽기까지 포함해
    `transaction()` 블록 안에서만 커서를 얻는다. 블록은 정상 종료에 commit, 예외에 rollback하므로
    어느 메서드가 실패해도 원 연결에 트랜잭션이 남지 않는다. 블록 없이 커서만 쓰면 psycopg가 연 암묵
    트랜잭션이 남아, 다음 쓰기의 블록이 savepoint로 바뀌고 조용히 되감길 수 있다(EAT-264·273·274).
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

    def _require_idle(self, operation: str) -> None:
        require_idle(
            self._connection,
            message=f"mart {operation} requires an idle repository connection",
            error_type=MartTransactionScopeError,
        )

    def open_build(self, plan: MartBuildPlan) -> OpenedMartBuild:
        key = {
            "mart_name": plan.mart_name,
            "calc_version": plan.calc_version,
            "source_release_id": plan.source_release_id,
            "publication_id": plan.publication_id,
        }
        self._require_idle("build open")
        with self._connection.transaction(), self._connection.cursor() as cursor:
            cursor.execute(_FIND_BUILD_SQL, key)
            existing = cursor.fetchone()
            if existing is not None:
                opened = self._reopen(cursor, plan, existing)
                if opened is not None:
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
                raise MartBuildContractError(
                    "mart build insertion returned no identity"
                )
        return OpenedMartBuild(
            build_id=int(created[0]), status="building", row_count=None
        )

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
        # 보유율·제외 부속 행도 이 build의 산출물이다. 남겨 두면 재개한 빌드가 같은 grain을 다시 넣다 끊긴다.
        for statement in _BUILD_SIDE_DELETES:
            cursor.execute(statement, (build_id,))
        if status == "building":
            return OpenedMartBuild(build_id=build_id, status="building", row_count=None)
        # 실패한 build는 `failed → building` 전이가 없으므로 행과 함께 지우고 새로 연다.
        cursor.execute("delete from mart.build where build_id = %s", (build_id,))
        return None

    def fill_build(self, plan: MartBuildPlan, build_id: int) -> int:
        builder = self._builders.get(plan.mart_name)
        if builder is None:
            raise MartBuildContractError(f"mart has no builder [mart={plan.mart_name}]")
        self._require_idle("build fill")
        # 빌더는 받은 연결로 커서만 연다. 트랜잭션은 여기서 하나로 연다 — 빌더가 도중에 무너지면 그
        # build의 행과 보유율이 함께 되감기고, 원 연결은 실패를 기록하기 전에 이미 비어 있다.
        with self._connection.transaction():
            fill_started_at = self._fill_clock()
            row_count = builder(self._connection, plan=plan, build_id=build_id)
            # 보유율은 같은 build의 사실이므로 같은 트랜잭션에서 쓴다. 지표만 발표되고 그 지표를
            # 어디까지 믿어도 되는지가 빠지면 화면이 모르는 것을 아는 척한다(AGENTS 3).
            fill_build_coverage(self._connection, plan=plan, build_id=build_id)
            # 제외 사실도 같은 이유로 같은 트랜잭션이다. 지표가 발표됐는데 "무엇이 빠졌는가"가 빠지면 화면이
            # 제외된 공고를 모르는 채로 표본을 말한다(ADR 0061 결정 6).
            fill_build_exclusions(self._connection, plan=plan, build_id=build_id)
            self._record_fill(build_id, fill_started_at)
        return row_count

    # 아래 둘은 fill_build의 트랜잭션 안에서만 부른다. 시각이 행과 함께 되감겨야 끊긴 채우기가 끝난 것으로 적히지 않는다.
    def _fill_clock(self) -> Any:
        with self._connection.transaction(), self._connection.cursor() as cursor:
            cursor.execute(_FILL_CLOCK_SQL)
            row = cursor.fetchone()
        if row is None:
            raise MartBuildContractError("database clock returned no row")
        return row[0]

    def _record_fill(self, build_id: int, fill_started_at: Any) -> None:
        with self._connection.transaction(), self._connection.cursor() as cursor:
            cursor.execute(_RECORD_FILL_SQL, (fill_started_at, build_id))
            if cursor.rowcount != 1:
                raise MartBuildContractError(
                    f"mart build was not building while filling [build_id={build_id}]"
                )

    def verify_build(self, plan: MartBuildPlan, build_id: int, row_count: int) -> None:
        """행 수를 고정하기 전에 실제로 저장된 행을 다시 센다.

        빌더가 돌려준 수를 그대로 믿으면 부분 적재가 "검증됨"으로 통과하고, 그 build가 활성이 되는
        순간 화면이 조용히 적은 표본을 본다(ADR 0010).

        지역 축도 같은 자리에서 확인한다. 한 build는 한 체계이며, 선언한 체계 밖의 코드를 실은 build를
        올리면 화면이 한 사다리에서 두 체계의 지역을 함께 읽는다(설계 §6 전환의 불변식).
        """
        self._require_idle("build verification")
        with self._connection.transaction(), self._connection.cursor() as cursor:
            assert_build_region_scheme(self._connection, plan=plan, build_id=build_id)
            cursor.execute(
                f"select count(*) from {MART_TABLES[plan.mart_name]} where build_id = %s",
                (build_id,),
            )
            stored = cursor.fetchone()
            if stored is None or int(stored[0]) != row_count:
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
                raise MartBuildContractError(
                    f"mart build was not building when verified [build_id={build_id}]"
                )

    def activate_build(self, plan: MartBuildPlan, build_id: int) -> None:
        retention = RETENTION.get(plan.mart_name, DEFAULT_RETENTION)
        self._require_idle("build activation")
        with self._connection.transaction(), self._connection.cursor() as cursor:
            cursor.execute(
                """
                update mart.build
                   set status = 'superseded', superseded_at = %s,
                       retain_until = %s + %s::interval
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
                # 블록이 되감으므로 위에서 물린 이전 active도 제자리로 돌아간다.
                raise MartBuildContractError(
                    f"mart build was not verified when activated [build_id={build_id}]"
                )

    def fail_build(self, build_id: int, failure_category: str) -> None:
        # 위 메서드들은 블록이 예외에 되감으므로 여기 올 때 원 연결은 보통 비어 있다. 그래도 먼저
        # 확인하는 이유는, 남은 트랜잭션이 이 build 행을 잠그고 있으면 아래 별도 연결이 그 잠금을
        # 끝없이 기다리고 실패는 기록되지 않기 때문이다. 끊긴 연결(UNKNOWN)은 되감을 수 없고 서버 쪽
        # 잠금도 세션과 함께 풀리므로 건드리지 않는다.
        rollback_leftover(self._connection)
        connection = self._connect()
        try:
            with connection.transaction(), connection.cursor() as cursor:
                cursor.execute(
                    """
                    update mart.build
                       set status = 'failed', failure_category = %s
                     where build_id = %s and status = 'building'
                    """,
                    (failure_category, build_id),
                )
        finally:
            connection.close()

    def run_mode(self, run_id: UUID) -> str | None:
        """이 빌드를 부른 run의 mode를 돌려준다. run이 없으면 None이고 호출부가 모름으로 다룬다."""
        self._require_idle("run mode lookup")
        with self._connection.transaction(), self._connection.cursor() as cursor:
            cursor.execute(_RUN_MODE_SQL, {"run_id": run_id})
            row = cursor.fetchone()
        return None if row is None else str(row[0])
