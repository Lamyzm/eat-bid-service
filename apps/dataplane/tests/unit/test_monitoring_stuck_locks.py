"""모듈 책임: 끝난 단계가 쥔 자물쇠(죽은 보유)를 가르는 경계와 그 경보 모양을 클러스터 없이 고정한다."""

from __future__ import annotations

import base64
import gzip
import json
from datetime import UTC, datetime, timedelta
from typing import Any

from eatbid.monitoring.cluster import (
    WORKFLOWS_PATH,
    evaluate_cluster,
    judge_stuck_locks,
)
from eatbid.monitoring.stuck_locks import find_stuck_locks, terminate_patch

_지금 = datetime(2026, 10, 15, 9, 0, tzinfo=UTC)
_회차 = "eatbid-replay-advance-1791876300"
_노드 = f"{_회차}-3920157644"
_자물쇠 = "eatbid/Mutex/eatbid-core-publication"


def _시각(minutes_ago: int) -> str:
    return (_지금 - timedelta(minutes=minutes_ago)).isoformat().replace("+00:00", "Z")


def _보유_회차(
    *,
    phase: str = "Running",
    node_phase: str = "Failed",
    node_started_ago: int = 30,
    node_finished_ago: int | None = None,
    finished_ago: int | None = None,
    holder: str | None = None,
    compressed: bool = False,
) -> dict[str, Any]:
    node: dict[str, Any] = {"id": _노드, "phase": node_phase, "startedAt": _시각(node_started_ago)}
    if node_finished_ago is not None:
        node["finishedAt"] = _시각(node_finished_ago)
    status: dict[str, Any] = {
        "phase": phase,
        "synchronization": {
            "mutex": {"holding": [{"mutex": _자물쇠, "holder": holder or f"eatbid/{_회차}/{_노드}"}]}
        },
    }
    nodes = {_노드: node}
    if compressed:
        status["compressedNodes"] = base64.b64encode(gzip.compress(json.dumps(nodes).encode())).decode()
    else:
        status["nodes"] = nodes
    if finished_ago is not None:
        status["finishedAt"] = _시각(finished_ago)
    return {
        "metadata": {
            "name": _회차,
            "labels": {"workflows.argoproj.io/cron-workflow": "eatbid-replay-advance"},
        },
        "status": status,
    }


def test_파드가_죽은_단계가_mutex를_쥔_채_Running이면_풀_수_있는_죽은_보유다() -> None:
    # 2026-10-14 17:29 재시작 뒤 모양이다. 단계는 Failed인데 끝난 시각이 비어 있었고 회차는 Running이었다.
    죽은_보유 = find_stuck_locks([_보유_회차()], now=_지금)

    assert [(s.workflow, s.cron, s.lock, s.holder_phase, s.releasable) for s in 죽은_보유] == [
        (_회차, "eatbid-replay-advance", _자물쇠, "Failed", True)
    ]
    assert 죽은_보유[0].since == _지금 - timedelta(minutes=30)


def test_보유_단계가_아직_돌고_있으면_죽은_보유가_아니다() -> None:
    assert find_stuck_locks([_보유_회차(node_phase="Running", node_started_ago=300)], now=_지금) == []


def test_단계가_막_끝난_것은_다음_reconcile을_기다린다() -> None:
    # 정상이면 수 초 안에 풀린다. 컨트롤러가 밀린 순간을 죽은 보유로 부르면 살아 있는 회차를 끊는다.
    회차 = _보유_회차(node_started_ago=40, node_finished_ago=3)

    assert find_stuck_locks([회차], now=_지금) == []


def test_끝난_시각이_있으면_시작이_아니라_끝부터_잰다() -> None:
    회차 = _보유_회차(node_started_ago=60, node_finished_ago=15)

    assert [s.since for s in find_stuck_locks([회차], now=_지금)] == [_지금 - timedelta(minutes=15)]


def test_끝난_회차가_자물쇠를_남기면_사람이_풀어야_하는_보유로_알린다() -> None:
    # 2026-09-20 모양이다. Terminate할 것이 없어 기계가 풀 수 없다.
    회차 = _보유_회차(phase="Failed", node_phase="Failed", finished_ago=20)

    assert [s.releasable for s in find_stuck_locks([회차], now=_지금)] == [False]


def test_막_끝난_회차의_자물쇠는_아직_보지_않는다() -> None:
    회차 = _보유_회차(phase="Succeeded", node_phase="Succeeded", finished_ago=2)

    assert find_stuck_locks([회차], now=_지금) == []


def test_접어_둔_노드_목록도_펴서_본다() -> None:
    # 큰 회차는 Argo가 노드를 compressedNodes로 접는다. 못 펴면 가장 큰 회차를 놓친다.
    assert [s.releasable for s in find_stuck_locks([_보유_회차(compressed=True)], now=_지금)] == [True]


def test_보유_노드를_모르면_판정하지_않는다() -> None:
    회차 = _보유_회차(holder=f"eatbid/{_회차}/사라진노드")

    assert find_stuck_locks([회차], now=_지금) == []


def test_다른_회차_이름으로_적힌_보유는_이_회차가_풀_수_없어_보지_않는다() -> None:
    회차 = _보유_회차(holder=f"eatbid/다른회차/{_노드}")

    assert find_stuck_locks([회차], now=_지금) == []


def test_semaphore_보유도_같은_경계로_본다() -> None:
    회차 = _보유_회차()
    회차["status"]["synchronization"] = {
        "semaphore": {
            "holding": [
                {
                    "semaphore": "eatbid/ConfigMap/eatbid-workflow-limits/eatbid-source-backfill",
                    "holders": [f"eatbid/{_회차}/{_노드}"],
                }
            ]
        }
    }

    assert [s.lock for s in find_stuck_locks([회차], now=_지금)] == [
        "eatbid/ConfigMap/eatbid-workflow-limits/eatbid-source-backfill"
    ]


def test_푸는_patch는_runbook과_같은_Terminate다() -> None:
    assert terminate_patch() == {"spec": {"shutdown": "Terminate"}}


def test_죽은_보유는_회차_이름과_푸는_명령을_적은_critical이다() -> None:
    위반 = judge_stuck_locks([_보유_회차()], now=_지금)

    assert [(v.key, v.severity) for v in 위반] == [(f"stuck-lock:{_회차}", "critical")]
    assert _회차 in 위반[0].detail
    assert "eatbid-core-publication" in 위반[0].detail
    assert "Terminate" in 위반[0].detail


def test_사람이_풀어야_하는_보유는_지우는_법을_적는다() -> None:
    위반 = judge_stuck_locks([_보유_회차(phase="Failed", finished_ago=20)], now=_지금)

    assert "delete wf" in 위반[0].detail
    assert "사람이" in 위반[0].explanation.impact


def test_회차_조회가_막히면_cron_판정과_자물쇠_판정_모두_모른다고_알린다() -> None:
    def 조회(path: str) -> list[dict[str, Any]]:
        if path == WORKFLOWS_PATH:
            raise PermissionError("workflows is forbidden")
        return []

    키 = {v.key for v in evaluate_cluster(조회, now=_지금)}

    assert {"cron-workflow:check-failed", "stuck-lock:check-failed"} <= 키
