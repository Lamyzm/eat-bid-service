"""모듈 책임: 과거 기록 mart 예약 회차가 무엇을 입력으로 삼고 어느 mart를 다시 만들지를 원장만 읽고 정한다.

왜 발행 DAG가 아니라 예약인가: 회차 요약·낙찰률 분포는 core 전량을 다시 읽어 매번 수십만~백만 행을 새 build로
쓴다. 발행마다 만들면 poll-open 한 회차가 36~46분이 되어 10분 예약의 사이 회차가 경보 없이 건너뛰어졌다(2026-09-29
운영 실측, ADR 0060). 예약은 여러 발행을 한 build로 묶는다.

빌드 입력(`source_release_id`, `publication_id`)은 **가장 늦게 발행된 publication**이다. 과거 기록 mart는 어차피
core 전량을 읽으므로 이 값은 계산 범위가 아니라 "어느 발행까지 반영했는가"의 계보다. 그 발행을 이미 같은 계산
규칙으로 반영한 활성 build가 있으면 다시 만들지 않는다 — 새 발행이 없는 회차는 아무것도 하지 않고 성공한다.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from eatbid.mart.build_marts import HISTORY_MARTS
from eatbid.mart.models import MartName

# 발행 시각이 같으면 id로 끊어 같은 원장에서 늘 같은 발행을 고른다.
#
# release는 두 길로 찾는다. 수집 run은 `source_release_run`에 매이지만 replay run은 매이지 않고 관측 매니페스트
# (`replay_input`)로 원 release를 가리킨다 — replay DAG가 marts 단계에 넘기던 것도 그 원 release다. 한 replay가
# 여러 release의 관측을 실을 수 있어 id가 가장 작은 것 하나로 정한다. 보유율(`build_coverage`)이 그 release의
# 창을 읽으므로 같은 원장이면 같은 release여야 재현된다.
_LATEST_PUBLICATION_SQL = """
select p.publication_id,
       coalesce(
         (select sr.source_release_id
            from ingest.source_release_run sr
           where sr.run_id = p.run_id
           order by sr.source_release_id
           limit 1),
         (select sro.source_release_id
            from ingest.replay_input ri
            join ingest.source_release_observation sro on sro.observation_id = ri.observation_id
           where ri.run_id = p.run_id
           order by sro.source_release_id
           limit 1)
       ) as source_release_id
  from ingest.publication p
 where p.status = 'published'
 order by p.activated_at desc, p.publication_id desc
 limit 1
"""

_ACTIVE_BUILDS_SQL = """
select mart_name, publication_id, calc_version
  from mart.build
 where status = 'active'
"""


class HistoryScheduleError(RuntimeError):
    """과거 기록 build의 입력을 원장에서 정할 수 없다."""


@dataclass(frozen=True, slots=True)
class PublishedInput:
    """과거 기록 build가 "여기까지 반영했다"고 적을 발행과 그 원 release다."""

    source_release_id: UUID
    publication_id: UUID


@dataclass(frozen=True, slots=True)
class ActiveBuildKey:
    """활성 build가 반영한 발행과 계산 규칙이다. 수동 전량 재빌드는 발행이 없어 None이다."""

    publication_id: UUID | None
    calc_version: str


@dataclass(frozen=True, slots=True)
class HistorySchedule:
    latest: PublishedInput | None
    active: Mapping[str, ActiveBuildKey]


def read_history_schedule(connection: Any) -> HistorySchedule:
    """최신 발행과 mart별 활성 build를 한 트랜잭션에서 읽는다. 쓰지 않는다.

    읽기도 블록 안에서 한다. 블록 없이 커서만 쓰면 psycopg가 연 암묵 트랜잭션이 남고, 뒤이은 build 개시의
    블록이 savepoint로 바뀌어 쓰기가 조용히 되감길 수 있다(ADR 0059).
    """
    with connection.transaction(), connection.cursor() as cursor:
        cursor.execute(_LATEST_PUBLICATION_SQL)
        latest_row = cursor.fetchone()
        cursor.execute(_ACTIVE_BUILDS_SQL)
        active = {
            str(row[0]): ActiveBuildKey(publication_id=row[1], calc_version=str(row[2]))
            for row in cursor.fetchall()
        }
    latest = None
    if latest_row is not None:
        if latest_row[1] is None:
            # 발행은 있는데 원 release를 못 찾는다. 추측으로 다른 release를 대면 보유율이 엉뚱한 창을 말한다.
            raise HistoryScheduleError(
                f"published publication has no source release [publication_id={latest_row[0]}]"
            )
        latest = PublishedInput(
            source_release_id=latest_row[1], publication_id=latest_row[0]
        )
    return HistorySchedule(latest=latest, active=active)


def history_marts_to_build(
    schedule: HistorySchedule, *, calc_version: str
) -> tuple[MartName, ...]:
    """최신 발행을 이 계산 규칙으로 아직 반영하지 않은 과거 기록 mart를 고른다.

    발행이 하나도 없으면 만들 입력이 없으므로 아무것도 고르지 않는다. 계산 규칙이 다르면 같은 발행이라도 다시
    만든다 — 새 calc-version을 배포한 뒤 첫 회차가 옛 규칙의 build를 새 규칙으로 바꾼다(ADR 0034).
    """
    latest = schedule.latest
    if latest is None:
        return ()
    return tuple(
        name
        for name in HISTORY_MARTS
        if schedule.active.get(name)
        != ActiveBuildKey(
            publication_id=latest.publication_id, calc_version=calc_version
        )
    )
