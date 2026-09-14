"""모듈 책임: 노드와 Argo Application을 정상·비정상으로 가르는 경계를 클러스터 없이 고정한다."""

from __future__ import annotations

from typing import Any

from eatbid.monitoring.cluster import (
    APPLICATIONS_PATH,
    NODES_PATH,
    evaluate_cluster,
    judge_applications,
    judge_nodes,
)


def _노드(
    *, name: str = "eatbid-k3s", ready: str = "True", unschedulable: bool = False
) -> dict[str, Any]:
    return {
        "metadata": {"name": name},
        "spec": {"unschedulable": unschedulable},
        "status": {
            "conditions": [
                {"type": "MemoryPressure", "status": "False"},
                {"type": "Ready", "status": ready},
            ]
        },
    }


def _앱(
    *, name: str = "eatbid", sync: str = "Synced", health: str = "Healthy"
) -> dict[str, Any]:
    return {
        "metadata": {"name": name},
        "status": {"sync": {"status": sync}, "health": {"status": health}},
    }


def test_준비된_노드는_위반이_아니다() -> None:
    assert judge_nodes([_노드()]) == []


def test_준비되지_않은_노드를_잡는다() -> None:
    # 2026-09-10에 옛 VM 노드가 28시간 죽어 있었고 사용자가 물어서 알았다.
    위반 = judge_nodes([_노드(ready="False")])

    assert [v.key for v in 위반] == ["node-health:not-ready:eatbid-k3s"]
    assert "Ready=False" in 위반[0].detail


def test_Ready_조건이_아예_없으면_모른다고_보고_잡는다() -> None:
    위반 = judge_nodes([{"metadata": {"name": "낯선노드"}, "status": {}}])

    assert [v.key for v in 위반] == ["node-health:not-ready:낯선노드"]
    assert "Ready=unknown" in 위반[0].detail


def test_cordon된_노드도_알린다() -> None:
    # 되돌리는 것을 잊으면 다음 회차가 조용히 Pending으로 쌓인다.
    위반 = judge_nodes([_노드(unschedulable=True)])

    assert [v.key for v in 위반] == ["node-health:unschedulable:eatbid-k3s"]


def test_노드가_없는_것을_이상_없음으로_읽지_않는다() -> None:
    위반 = judge_nodes([])

    assert [v.key for v in 위반] == ["node-health:empty"]


def test_노드마다_key가_달라_여럿이_동시에_보인다() -> None:
    위반 = judge_nodes(
        [_노드(name="가", ready="False"), _노드(name="나", ready="Unknown")]
    )

    assert sorted(v.key for v in 위반) == [
        "node-health:not-ready:가",
        "node-health:not-ready:나",
    ]


def test_Synced이고_Healthy면_위반이_아니다() -> None:
    assert judge_applications([_앱()]) == []


def test_OutOfSync를_잡는다() -> None:
    # Synced가 곧 배포 digest 일치다. Argo CD가 이미 계산해 둔 답을 그대로 쓴다.
    위반 = judge_applications([_앱(sync="OutOfSync")])

    assert [v.key for v in 위반] == ["argocd-application:eatbid"]
    assert "sync=OutOfSync" in 위반[0].detail


def test_Degraded를_잡는다() -> None:
    위반 = judge_applications([_앱(health="Degraded")])

    assert [v.key for v in 위반] == ["argocd-application:eatbid"]


def test_동기화_중인_Progressing은_울리지_않는다() -> None:
    # 회차마다 울리면 배포할 때마다 알림이 온다.
    assert judge_applications([_앱(health="Progressing")]) == []


def test_Application이_하나도_없는_것을_이상_없음으로_읽지_않는다() -> None:
    assert [v.key for v in judge_applications([])] == ["argocd-application:empty"]


def test_한쪽_조회가_막혀도_다른_쪽_판정은_산다() -> None:
    # Application 읽기 권한만 빠져 있을 때 노드 상태까지 함께 모르는 상태가 되면 안 된다.
    def 조회(path: str) -> list[dict[str, Any]]:
        if path == APPLICATIONS_PATH:
            raise PermissionError("applications is forbidden")
        return [_노드(ready="False")]

    위반 = evaluate_cluster(조회)

    assert sorted(v.key for v in 위반) == [
        "argocd-application:check-failed",
        "node-health:not-ready:eatbid-k3s",
    ]


def test_둘_다_정상이면_아무것도_올리지_않는다() -> None:
    def 조회(path: str) -> list[dict[str, Any]]:
        return [_노드()] if path == NODES_PATH else [_앱()]

    assert evaluate_cluster(조회) == []
