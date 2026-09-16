"""모듈 책임: `retain_until`이 지난 superseded build의 mart 행을 회수하고 build 원장 행은 계보로 남긴다.

ADR 0034가 허용한 유일한 공개 mart 행 삭제다. "회수됐다"는 사실을 원장에 열로 더하지 않는 이유는 원장의
불변 규칙(활성·물린 build의 계보 열은 바꾸지 못한다)에 예외를 내지 않기 위해서다 — 회수 여부는 "그
build의 행이 없다"로 파생된다(EAT-254). 1일 보존인 mart가 하루 66번 물리면서 900 build·20GB가 쌓였고
그중 활성은 셋뿐이었다.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from eatbid.mart.models import MartName


@dataclass(frozen=True, slots=True)
class ReapTarget:
    mart_name: MartName
    table: str


# mart 이름과 표 이름이 같지만 둘로 적는 이유는 write-map gate가 실행 시점 표 이름 쓰기를
# `table="..."` 리터럴로 잇기 때문이다. 새 mart를 더하면 `MART_TABLES`와 함께 여기도 움직인다.
REAP_TARGETS: tuple[ReapTarget, ...] = (
    ReapTarget(mart_name="org_round_summary", table="org_round_summary"),
    ReapTarget(
        mart_name="win_rate_distribution_monthly", table="win_rate_distribution_monthly"
    ),
    ReapTarget(mart_name="open_auction_snapshot", table="open_auction_snapshot"),
)

# 회수 시한이 지났고 아직 회수되지 않은 superseded build다. `for update`를 잡지 않는 이유는 superseded는
# 종착 상태라 누구도 바꾸지 않고, 행 삭제 자체는 표의 trigger가 build 상태로 다시 거르기 때문이다.
_EXPIRED_BUILDS_SQL = """
select build_id, mart_name, retain_until
  from mart.build
 where status = 'superseded'
   and retain_until < %(as_of)s
 order by retain_until, build_id
"""


@dataclass(frozen=True, slots=True)
class ReapedBuild:
    build_id: int
    mart_name: MartName
    rows_deleted: int
    retain_until: datetime


@dataclass(frozen=True, slots=True)
class ReapReport:
    as_of: datetime
    reaped: tuple[ReapedBuild, ...]

    @property
    def rows_deleted(self) -> int:
        return sum(item.rows_deleted for item in self.reaped)

    def to_document(self) -> dict[str, object]:
        return {
            "reaped_builds": len(self.reaped),
            "deleted_rows": self.rows_deleted,
            "builds": [
                {
                    "build_id": item.build_id,
                    "mart_name": item.mart_name,
                    "rows_deleted": item.rows_deleted,
                    "retain_until": item.retain_until.isoformat(),
                }
                for item in self.reaped
            ],
        }


def reap_expired_builds(connection: Any, *, as_of: datetime) -> ReapReport:
    """시한이 지난 build를 하나씩 회수한다. build마다 commit하므로 중간에 죽어도 지운 만큼은 남고, 다시
    부르면 남은 것부터 이어 간다. 이미 행이 없는 build는 보고에 실리지 않는다 — 같은 명령을 매일 불러도
    보고는 그날 실제로 지운 것만 말한다."""
    tables = {target.mart_name: target.table for target in REAP_TARGETS}
    with connection.cursor() as cursor:
        cursor.execute(_EXPIRED_BUILDS_SQL, {"as_of": as_of})
        expired = [(int(row[0]), str(row[1]), row[2]) for row in cursor.fetchall()]
    reaped: list[ReapedBuild] = []
    for build_id, mart_name, retain_until in expired:
        table = tables.get(mart_name)
        if table is None:
            raise ValueError(f"unknown mart in build ledger [mart={mart_name}]")
        with connection.cursor() as cursor:
            cursor.execute(f"delete from mart.{table} where build_id = %s", (build_id,))
            rows_deleted = int(cursor.rowcount)
            # 보유율 행도 그 build의 산출물이다. 행이 없는 build의 보유율은 아무것도 설명하지 않는다.
            cursor.execute(
                "delete from mart.build_coverage where build_id = %s", (build_id,)
            )
            coverage_deleted = int(cursor.rowcount)
        connection.commit()
        if rows_deleted or coverage_deleted:
            reaped.append(
                ReapedBuild(
                    build_id=build_id,
                    mart_name=mart_name,  # type: ignore[arg-type]
                    rows_deleted=rows_deleted,
                    retain_until=retain_until,
                )
            )
    return ReapReport(as_of=as_of, reaped=tuple(reaped))
