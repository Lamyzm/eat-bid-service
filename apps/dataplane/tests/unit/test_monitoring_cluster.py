"""모듈 책임: 노드와 Argo Application을 정상·비정상으로 가르는 경계를 클러스터 없이 고정한다."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from eatbid.monitoring.cluster import (
    APPLICATIONS_PATH,
    NODES_PATH,
    WORKFLOWS_PATH,
    evaluate_cluster,
    judge_applications,
    judge_cron_workflows,
    judge_nodes,
)

_지금 = datetime(2026, 9, 14, 12, 0, tzinfo=UTC)


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


def _회차(
    *,
    cron: str | None = "eatbid-backfill-advance",
    phase: str = "Succeeded",
    minutes_ago: int = 10,
    name: str = "eatbid-backfill-advance-1789383600",
    message: str = "",
) -> dict[str, Any]:
    metadata: dict[str, Any] = {
        "name": name,
        "creationTimestamp": (_지금 - timedelta(minutes=minutes_ago))
        .isoformat()
        .replace("+00:00", "Z"),
    }
    if cron is not None:
        metadata["labels"] = {"workflows.argoproj.io/cron-workflow": cron}
    return {"metadata": metadata, "status": {"phase": phase, "message": message}}


def test_최근_회차가_성공이면_위반이_없다() -> None:
    assert judge_cron_workflows([_회차()], now=_지금) == []


def test_최근_회차가_실패하면_cron_이름으로_잡는다() -> None:
    위반 = judge_cron_workflows(
        [_회차(phase="Failed", message="main: Error (exit code 64)")], now=_지금
    )

    assert [v.key for v in 위반] == ["cron-workflow:eatbid-backfill-advance"]
    assert "exit code 64" in 위반[0].detail


def test_보존_편향_때문에_오래된_실패는_울리지_않는다() -> None:
    # 성공은 1시간, 실패는 24시간 남는다. 뒤따른 성공들이 먼저 지워지므로 "남은 것 중 최신이 실패"는
    # 시간이 지나면 반드시 참이 된다. 2026-09-14 21시에 poll-open이 정확히 그 모양이었다.
    위반 = judge_cron_workflows(
        [_회차(cron="eatbid-poll-open", phase="Failed", minutes_ago=370)], now=_지금
    )

    assert 위반 == []


def test_성공이_실패보다_나중이면_위반이_아니다() -> None:
    위반 = judge_cron_workflows(
        [
            _회차(phase="Failed", minutes_ago=70, name="옛회차"),
            _회차(phase="Succeeded", minutes_ago=5, name="새회차"),
        ],
        now=_지금,
    )

    assert 위반 == []


def test_실패가_성공보다_나중이면_위반이다() -> None:
    위반 = judge_cron_workflows(
        [
            _회차(phase="Succeeded", minutes_ago=70, name="옛회차"),
            _회차(phase="Failed", minutes_ago=5, name="새회차"),
        ],
        now=_지금,
    )

    assert [v.key for v in 위반] == ["cron-workflow:eatbid-backfill-advance"]
    assert "새회차" in 위반[0].detail


def test_사람이_제출한_회차는_보지_않는다() -> None:
    # 다음 회차라는 것이 없고, 실패했다면 제출한 사람이 그 자리에서 본다.
    assert judge_cron_workflows([_회차(cron=None, phase="Failed")], now=_지금) == []


def test_cron마다_따로_본다() -> None:
    위반 = judge_cron_workflows(
        [
            _회차(cron="가", phase="Failed", name="가회차"),
            _회차(cron="나", phase="Succeeded", name="나회차"),
            _회차(cron="다", phase="Error", name="다회차"),
        ],
        now=_지금,
    )

    assert sorted(v.key for v in 위반) == ["cron-workflow:가", "cron-workflow:다"]


def test_남은_회차가_없으면_위반이_아니다() -> None:
    # 성공이 TTL로 지워진 것과 한 번도 안 돈 것을 구분할 수 없고, 구분할 수 없는 것을 위반이라
    # 부르면 매일 울린다.
    assert judge_cron_workflows([], now=_지금) == []


def test_한쪽_조회가_막혀도_다른_쪽_판정은_산다() -> None:
    # Application 읽기 권한만 빠져 있을 때 노드 상태까지 함께 모르는 상태가 되면 안 된다.
    def 조회(path: str) -> list[dict[str, Any]]:
        if path == APPLICATIONS_PATH:
            raise PermissionError("applications is forbidden")
        if path == WORKFLOWS_PATH:
            return []
        return [_노드(ready="False")]

    위반 = evaluate_cluster(조회, now=_지금)

    assert sorted(v.key for v in 위반) == [
        "argocd-application:check-failed",
        "node-health:not-ready:eatbid-k3s",
    ]


def test_셋_다_정상이면_아무것도_올리지_않는다() -> None:
    def 조회(path: str) -> list[dict[str, Any]]:
        if path == NODES_PATH:
            return [_노드()]
        if path == APPLICATIONS_PATH:
            return [_앱()]
        return [_회차()]

    assert evaluate_cluster(조회, now=_지금) == []
