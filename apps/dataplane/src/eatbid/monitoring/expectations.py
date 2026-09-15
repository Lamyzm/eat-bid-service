"""모듈 책임: 운영이 지켜야 할 기대를 선언 목록 하나로 두고, 주입된 질의 실행기로 위반만 판정한다.

왜 질의로 선언하는가: 파이프라인의 진실은 PostgreSQL이고 지표는 파생물이다(ADR 0046 결정 4). 지표에서
판정하면 지표 수집이 멈춘 순간 조용히 정상으로 보인다. 그래서 각 기대는 DB에 직접 묻고, 만족하면 0행을
돌려주고 어긋나면 위반을 설명하는 행을 돌려준다.

왜 순수 함수인가: 임계와 문구는 DB 없이 검증할 수 있어야 한다. I/O는 호출자가 넣는다.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any

QueryRunner = Callable[[str, Mapping[str, Any]], Sequence[Mapping[str, Any]]]


@dataclass(frozen=True)
class Expectation:
    """하나의 기대. `sql`은 만족하면 0행, 어긋나면 위반 행을 돌려준다.

    `runbook`은 알림 문구에 그대로 실린다. 대응 문서 위치가 알림에 없으면 받는 사람이 무엇을 해야 할지
    다시 찾아야 하고, 그 사이가 사고 시간이 된다.
    """

    key: str
    title: str
    runbook: str
    sql: str
    parameters: Mapping[str, Any]
    # 여러 행을 낼 수 있는 기대는 행을 가르는 컬럼을 적는다. 없으면 행마다 같은 key가 되고, 상태 파일은
    # key로 집합을 만들므로 한 행이 다른 행을 덮어쓴다. 그러면 이미 열려 있는 위반 하나가 새로 생긴
    # 위반을 통째로 가린다 — 2026-09-06부터 `running`으로 남은 reference run 하나가 실제로 이틀 동안
    # backfill 멈춤 감시를 눈멀게 하고 있었다.
    key_columns: tuple[str, ...] = ()


@dataclass(frozen=True)
class Violation:
    key: str
    title: str
    runbook: str
    detail: str


def _detail(row: Mapping[str, Any]) -> str:
    return ", ".join(f"{name}={value}" for name, value in row.items())


def _row_key(expectation: Expectation, row: Mapping[str, Any]) -> str:
    """행마다 다른 key를 만든다. 가르는 컬럼을 선언하지 않은 기대는 기대 key를 그대로 쓴다.

    선언한 컬럼이 결과에 없으면 `unknown`으로 채운다. 그 경우 여러 행이 다시 한 key로 합쳐지지만,
    질의를 잘못 적었다는 이유로 감시를 멈추는 것보다는 덜 알리는 쪽이 낫다.
    """
    if not expectation.key_columns:
        return expectation.key
    parts = [str(row.get(column, "unknown")) for column in expectation.key_columns]
    return ":".join([expectation.key, *parts])


# 2026-09-10 사고 여섯 중 다섯이 예외가 아니라 조용한 멈춤이었다. 그 다섯을 이 목록이 직접 겨눈다.
# 임계는 넉넉하게 잡는다. 좁게 잡으면 정상 변동에도 울려 사람이 알림을 무시하게 된다.
EXPECTATIONS: tuple[Expectation, ...] = (
    Expectation(
        key="backfill-progress",
        title="실행 중인 backfill이 진행하고 있다",
        runbook="docs/operations/collection-runbook.md#44-재부팅컨트롤러-재시작이-남긴-semaphore-교착-풀기-2026-09-10-eat-129",
        # 왜 관측의 최신 fetched_at을 보는가: workflow가 Running이어도 자물쇠에 막히면 아무것도
        # 진행하지 않는다(2026-09-10 2시간 교착). 상태가 아니라 전진을 본다. `request_unit`에는 시각
        # 컬럼이 없으므로(2026-09-11 실제 스키마 확인) 전진의 증거는 관측이 들어온 시각이다.
        # run이 막 시작해 아직 관측이 없는 구간을 위반으로 보지 않도록 run의 시작 시각도 함께 본다.
        sql="""
            select r.run_id::text as run_id,
                   r.mode as mode,
                   r.started_at as started_at,
                   max(o.fetched_at) as last_observation_at
              from ingest.run r
              left join ingest.raw_observation o using (run_id)
             where r.status = 'running'
               and r.started_at < now() - %(stall_after)s::interval
             group by r.run_id, r.mode, r.started_at
            having coalesce(max(o.fetched_at), r.started_at) < now() - %(stall_after)s::interval
        """,
        parameters={"stall_after": "90 minutes"},
        key_columns=("run_id",),
    ),
    Expectation(
        key="planned-release-age",
        title="발행에 이르지 못한 release가 오래 쌓이지 않았다",
        runbook="docs/operations/collection-runbook.md#4-capturenormalize-단계가-죽은-실행-복구-2026-09-10-eat-122",
        # 2026-09-10에 planned가 5일 동안 14건까지 쌓였는데 아무도 몰랐다. 세어보기 전에는 존재하지 않는
        # 사실이라 로그에도 오류 추적기에도 남지 않는다.
        sql="""
            select count(*) as stale_planned_releases,
                   min(as_of) as oldest_as_of
              from ingest.source_release
             where status = 'planned'
               and as_of < now() - %(allowed_age)s::interval
            having count(*) > %(allowed_count)s
        """,
        parameters={"allowed_age": "24 hours", "allowed_count": 2},
    ),
    Expectation(
        key="capture-freshness",
        title="영업시간에 열린 공고 수집이 멈추지 않았다",
        runbook="docs/operations/collection-runbook.md#44-재부팅컨트롤러-재시작이-남긴-semaphore-교착-풀기-2026-09-10-eat-129",
        # poll-open은 평일 08:00~19:50 KST에 10분마다 돈다. 그 창 안에서 마지막 run이 너무 오래됐다면
        # 회차가 통째로 건너뛰어지고 있다는 뜻이다(2026-09-10 여섯 회차 누락).
        #
        # 영업시간 판정이 where가 아니라 having에 있는 이유: where에 두면 창 밖에서 행이 하나도 남지
        # 않고, 집계 질의는 그래도 한 행을 내므로 max()가 NULL이 되어 `is null` 가지가 참이 된다.
        # 2026-09-14 21시에 실제로 그렇게 울렸다 — `last_poll_open_at=None`이 그 자국이다. 매일 저녁과
        # 주말마다 나던 거짓 경보이며, 아침 첫 회차가 그것을 해소로 닫아 두 번씩 알렸다.
        #
        # 창을 9시부터 여는 이유: 이 검사는 :03에도 돈다. 8시로 열면 08:03 회차가 "45분 안의 run"으로
        # 인정할 수 있는 것이 그날 08:00 회차 하나뿐이고, 그 회차가 조금만 늦어도 전날 19:50과 비교해
        # 거짓 경보가 난다. 9시로 열면 08:20~09:00 회차들이 이미 쌓여 있다. 대가는 아침 전체가 죽은
        # 사고를 한 시간 늦게 아는 것이다.
        sql="""
            select max(r.started_at) as last_poll_open_at
              from ingest.run r
             where r.mode = 'poll-open'
            having extract(isodow from now() at time zone 'Asia/Seoul') <= 5
               and extract(hour from now() at time zone 'Asia/Seoul')
                   between %(window_start_hour)s and %(window_end_hour)s
               and (max(r.started_at) is null
                    or max(r.started_at) < now() - %(stall_after)s::interval)
        """,
        parameters={
            "window_start_hour": 9,
            "window_end_hour": 19,
            "stall_after": "45 minutes",
        },
    ),
)


def evaluate(
    run_query: QueryRunner,
    expectations: Sequence[Expectation] = EXPECTATIONS,
) -> list[Violation]:
    """각 기대를 평가해 위반만 돌려준다.

    질의 자체가 실패하면 그 사실을 위반으로 올린다. 검사가 조용히 죽는 것이 검사 없는 것보다 나쁘다.
    """
    violations: list[Violation] = []
    for expectation in expectations:
        try:
            rows = run_query(expectation.sql, expectation.parameters)
        except Exception as error:  # noqa: BLE001 - 어떤 실패든 사람에게 알린다
            violations.append(
                Violation(
                    key=f"{expectation.key}:check-failed",
                    title=f"기대 '{expectation.title}'를 평가하지 못했다",
                    runbook=expectation.runbook,
                    detail=f"{type(error).__name__}: {error}",
                )
            )
            continue
        for row in rows:
            violations.append(
                Violation(
                    key=_row_key(expectation, row),
                    title=expectation.title,
                    runbook=expectation.runbook,
                    detail=_detail(row),
                )
            )
    return violations
