"""모듈 책임: 자물쇠 풀기가 무엇을 끊고 무엇을 사람에게 남기는지, 실패를 어떻게 드러내는지 클러스터 없이 고정한다."""

from __future__ import annotations

from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
from typing import Any

from eatbid.recovery.release_locks import (
    NUDGE_ANNOTATION,
    REPORT_COMPLETED_LABEL,
    TASK_RESULTS_PATH,
    WORKFLOWS_PATH,
    release_stuck_locks,
)

_지금 = datetime(2026, 10, 15, 9, 0, tzinfo=UTC)


def _시각(minutes_ago: int) -> str:
    return (_지금 - timedelta(minutes=minutes_ago)).isoformat().replace("+00:00", "Z")


def _회차(
    name: str,
    *,
    phase: str = "Running",
    node_phase: str = "Failed",
    shutdown: str | None = None,
    finished_ago: int | None = None,
) -> dict[str, Any]:
    node_id = f"{name}-1"
    status: dict[str, Any] = {
        "phase": phase,
        "nodes": {node_id: {"id": node_id, "phase": node_phase, "startedAt": _시각(40)}},
        "synchronization": {
            "mutex": {
                "holding": [
                    {"mutex": "eatbid/Mutex/eatbid-core-publication", "holder": f"eatbid/{name}/{node_id}"}
                ]
            }
        },
    }
    if finished_ago is not None:
        status["finishedAt"] = _시각(finished_ago)
    spec: dict[str, Any] = {"shutdown": shutdown} if shutdown else {}
    return {"metadata": {"name": name}, "spec": spec, "status": status}


class _가짜API:
    def __init__(
        self,
        workflows: list[dict[str, Any]],
        task_results: Mapping[str, Mapping[str, Any]] | None = None,
        fail_on: str | None = None,
    ) -> None:
        self.workflows = workflows
        self.task_results = dict(task_results or {})
        self.fail_on = fail_on
        self.patches: list[tuple[str, Mapping[str, Any]]] = []

    def list_items(self, path: str) -> list[Mapping[str, Any]]:
        assert path == WORKFLOWS_PATH
        return list(self.workflows)

    def get(self, path: str) -> Mapping[str, Any] | None:
        return self.task_results.get(path)

    def merge_patch(self, path: str, body: Mapping[str, Any]) -> None:
        if self.fail_on is not None and self.fail_on in path:
            raise PermissionError("workflows is forbidden")
        self.patches.append((path, body))


def _미완료_보고(node_id: str) -> dict[str, Mapping[str, Any]]:
    return {
        f"{TASK_RESULTS_PATH}/{node_id}": {
            "metadata": {"name": node_id, "labels": {REPORT_COMPLETED_LABEL: "false"}}
        }
    }


def test_죽은_보유_회차를_Terminate하고_미완료_보고를_완료로_표시한다() -> None:
    api = _가짜API([_회차("가")], _미완료_보고("가-1"))

    보고 = release_stuck_locks(api, now=_지금)

    assert api.patches == [
        (f"{WORKFLOWS_PATH}/가", {"spec": {"shutdown": "Terminate"}}),
        (f"{TASK_RESULTS_PATH}/가-1", {"metadata": {"labels": {REPORT_COMPLETED_LABEL: "true"}}}),
    ]
    assert 보고.terminated == ("가",)
    assert 보고.completed_reports == ("eatbid/가/가-1",)
    assert 보고.failures == ()


def test_이미_Terminate가_걸렸으면_보고만_마무리한다() -> None:
    # 2026-10-16 로컬 재현에서 Steps 회차는 Terminate 뒤에도 보고 표시가 없으면 풀리지 않았다.
    api = _가짜API([_회차("가", shutdown="Terminate")], _미완료_보고("가-1"))

    release_stuck_locks(api, now=_지금)

    assert [path for path, _ in api.patches] == [f"{TASK_RESULTS_PATH}/가-1"]


def test_보고가_이미_완료거나_없으면_표시하지_않는다() -> None:
    완료 = {f"{TASK_RESULTS_PATH}/가-1": {"metadata": {"labels": {REPORT_COMPLETED_LABEL: "true"}}}}
    api = _가짜API([_회차("가"), _회차("나")], 완료)

    보고 = release_stuck_locks(api, now=_지금)

    assert [path for path, _ in api.patches] == [f"{WORKFLOWS_PATH}/가", f"{WORKFLOWS_PATH}/나"]
    assert 보고.completed_reports == ()


def test_살아_있는_보유는_건드리지_않는다() -> None:
    api = _가짜API([_회차("가", node_phase="Running")])

    보고 = release_stuck_locks(api, now=_지금)

    assert api.patches == []
    assert 보고.terminated == ()


def test_끝난_회차가_남긴_자물쇠는_사람에게_남긴다() -> None:
    # 회차를 지우고 컨트롤러를 다시 띄워야 하는 꼴이다. 기계가 관측 기록을 지우지 않는다.
    api = _가짜API([_회차("가", phase="Failed", finished_ago=30)])

    보고 = release_stuck_locks(api, now=_지금)

    assert api.patches == []
    assert 보고.left_for_human == ("가",)


def test_한_회차의_patch가_실패해도_다른_회차는_푼다() -> None:
    api = _가짜API([_회차("가"), _회차("나")], fail_on="/workflows/가")

    보고 = release_stuck_locks(api, now=_지금)

    assert [path for path, _ in api.patches] == [f"{WORKFLOWS_PATH}/나"]
    assert 보고.terminated == ("나",)
    assert len(보고.failures) == 1 and 보고.failures[0].startswith("가: PermissionError")


def _대기_회차(name: str, *, holder: str) -> dict[str, Any]:
    return {
        "metadata": {"name": name},
        "spec": {},
        "status": {
            "phase": "Running",
            "nodes": {},
            "synchronization": {
                "mutex": {"waiting": [{"mutex": "eatbid/Mutex/eatbid-core-publication", "holder": holder}]}
            },
        },
    }


def test_주인이_놓은_자물쇠를_아직_기다리는_회차를_깨운다() -> None:
    # 2026-09-10에는 자물쇠가 풀려도 기다리던 회차가 다시 시도하지 않아 사람이 annotation으로 깨웠다.
    api = _가짜API([_대기_회차("기다림", holder="eatbid/사라진회차/사라진회차-1")])

    보고 = release_stuck_locks(api, now=_지금)

    assert api.patches == [
        (f"{WORKFLOWS_PATH}/기다림", {"metadata": {"annotations": {NUDGE_ANNOTATION: _지금.isoformat()}}})
    ]
    assert 보고.nudged == ("기다림",)


def test_주인이_아직_쥐고_있는_정상_대기는_깨우지_않는다() -> None:
    살아_있는_주인 = _회차("가", node_phase="Running")
    api = _가짜API([살아_있는_주인, _대기_회차("기다림", holder="eatbid/가/가-1")])

    보고 = release_stuck_locks(api, now=_지금)

    assert api.patches == []
    assert 보고.nudged == ()


def test_이번에_끊은_회차의_대기자는_다음_회차에서_깨운다() -> None:
    # 끊은 회차의 자물쇠는 컨트롤러가 처리한 뒤에 풀린다. 같은 회차에서 깨우면 아직 쥔 자물쇠를 보고 다시 잠든다.
    api = _가짜API([_회차("가"), _대기_회차("기다림", holder="eatbid/가/가-1")])

    보고 = release_stuck_locks(api, now=_지금)

    assert 보고.terminated == ("가",)
    assert 보고.nudged == ()


def test_같은_자물쇠를_이미_쥔_회차의_지나간_대기_기록으로는_깨우지_않는다() -> None:
    # 2026-10-16 로컬 재현에서 먼저 기다리다 자물쇠를 받은 회차의 상태에 옛 대기 기록이 남아 있었다.
    쥔_회차 = _회차("가", node_phase="Running")
    쥔_회차["status"]["synchronization"]["mutex"]["waiting"] = [
        {"mutex": "eatbid/Mutex/eatbid-core-publication", "holder": "eatbid/끝난회차/끝난회차-1"}
    ]
    api = _가짜API([쥔_회차])

    assert release_stuck_locks(api, now=_지금).nudged == ()
