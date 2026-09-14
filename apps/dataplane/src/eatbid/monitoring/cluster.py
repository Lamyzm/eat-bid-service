"""모듈 책임: 노드와 Argo CD Application이 정상인지를 Kubernetes API가 준 상태만 보고 판정한다.

왜 이 둘인가: 2026-09-10에 옛 VM 노드가 28시간 죽어 있었고 사용자가 물어서 알았다. 노드가 죽으면 그 위의
모든 기대가 함께 죽으므로 DB 질의로는 영영 못 잡는다. Application은 저장소와 클러스터가 벌어진 것을
Argo CD가 이미 계산해 둔 답이다 — 우리가 manifest를 다시 비교하면 같은 질문에 답하는 자리가 둘이 된다.

왜 판정이 순수 함수인가: Ready·Synced·Healthy의 경계는 클러스터 없이 검증할 수 있어야 한다. 조회는
호출자가 넣는다.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from typing import Any

from .expectations import Violation

__all__ = [
    "APPLICATION_RUNBOOK",
    "NODE_RUNBOOK",
    "ResourceLister",
    "evaluate_cluster",
    "judge_applications",
    "judge_nodes",
]

NODE_RUNBOOK = "docs/operations/k3s-hyperv-vm.md"
APPLICATION_RUNBOOK = "docs/operations/ci-gate-failure-response.md"

ResourceLister = Callable[[str], Sequence[Mapping[str, Any]]]
"""API 경로 하나를 받아 그 목록의 `items`를 돌려준다. 경로를 문자열로 두는 이유는 노드와 Application이
서로 다른 API group에 있고, 그 차이를 이 모듈이 알 필요가 없기 때문이다."""

NODES_PATH = "/api/v1/nodes"
APPLICATIONS_PATH = "/apis/argoproj.io/v1alpha1/namespaces/argocd/applications"


def _name(resource: Mapping[str, Any]) -> str:
    metadata = resource.get("metadata")
    if isinstance(metadata, Mapping):
        return str(metadata.get("name") or "unknown")
    return "unknown"


def judge_nodes(nodes: Sequence[Mapping[str, Any]]) -> list[Violation]:
    """`Ready`가 아니거나 스케줄이 막힌 노드를 위반으로 돌려준다.

    노드가 0개인 것도 위반이다. 목록이 비었다는 것은 클러스터가 비었다는 뜻이고, 그것을 "이상 없음"으로
    읽으면 가장 큰 사고가 가장 조용해진다.
    """
    if not nodes:
        return [
            Violation(
                key="node-health:empty",
                title="노드가 하나도 없다",
                runbook=NODE_RUNBOOK,
                detail="Kubernetes API가 노드를 하나도 돌려주지 않았다",
            )
        ]

    violations: list[Violation] = []
    for node in nodes:
        name = _name(node)
        status = node.get("status")
        conditions = status.get("conditions") if isinstance(status, Mapping) else None
        ready = "unknown"
        for condition in conditions or ():
            if isinstance(condition, Mapping) and condition.get("type") == "Ready":
                ready = str(condition.get("status") or "unknown")
                break
        spec = node.get("spec")
        unschedulable = (
            bool(spec.get("unschedulable")) if isinstance(spec, Mapping) else False
        )

        if ready != "True":
            violations.append(
                Violation(
                    key=f"node-health:not-ready:{name}",
                    title="노드가 정상이다",
                    runbook=NODE_RUNBOOK,
                    detail=f"노드={name}, Ready={ready}",
                )
            )
        elif unschedulable:
            # Ready이면서 스케줄이 막힌 상태는 사람이 의도적으로 cordon한 것일 수도 있다. 그래도
            # 알린다 — 되돌리는 것을 잊으면 다음 회차가 조용히 Pending으로 쌓인다.
            violations.append(
                Violation(
                    key=f"node-health:unschedulable:{name}",
                    title="노드가 새 파드를 받는다",
                    runbook=NODE_RUNBOOK,
                    detail=f"노드={name}, cordon됨",
                )
            )
    return violations


def judge_applications(applications: Sequence[Mapping[str, Any]]) -> list[Violation]:
    """`Synced`가 아니거나 `Healthy`가 아닌 Application을 위반으로 돌려준다.

    `Synced`가 곧 배포 digest 일치다. Argo CD가 라이브 리소스와 `deploy/prod`의 manifest를 비교해 둔
    답이므로 image digest 드리프트를 여기서 함께 받는다 — 우리가 kustomization을 다시 읽어 비교하면
    같은 질문의 답이 둘이 되고, 둘이 어긋나는 날 어느 쪽이 맞는지 알 방법이 없다.
    """
    if not applications:
        return [
            Violation(
                key="argocd-application:empty",
                title="Argo CD Application이 하나도 없다",
                runbook=APPLICATION_RUNBOOK,
                detail="Kubernetes API가 Application을 하나도 돌려주지 않았다",
            )
        ]

    violations: list[Violation] = []
    for application in applications:
        name = _name(application)
        status = application.get("status")
        sync = "unknown"
        health = "unknown"
        if isinstance(status, Mapping):
            sync_block = status.get("sync")
            if isinstance(sync_block, Mapping):
                sync = str(sync_block.get("status") or "unknown")
            health_block = status.get("health")
            if isinstance(health_block, Mapping):
                health = str(health_block.get("status") or "unknown")

        # `Progressing`은 동기화 도중의 정상 상태다. 회차마다 울리면 배포할 때마다 알림이 온다.
        if sync != "Synced" or health not in {"Healthy", "Progressing"}:
            violations.append(
                Violation(
                    key=f"argocd-application:{name}",
                    title="Argo CD Application이 저장소와 같고 정상이다",
                    runbook=APPLICATION_RUNBOOK,
                    detail=f"application={name}, sync={sync}, health={health}",
                )
            )
    return violations


def evaluate_cluster(list_resources: ResourceLister) -> list[Violation]:
    """노드와 Application을 조회해 위반만 돌려준다.

    둘을 따로 감싸는 이유는 한쪽 조회가 막혀도 다른 쪽 판정은 살아야 하기 때문이다. Application 읽기
    권한만 빠져 있을 때 노드 상태까지 함께 모르는 상태가 되면 안 된다.
    """
    violations: list[Violation] = []
    for path, key, title, runbook, judge in (
        (NODES_PATH, "node-health", "노드가 정상이다", NODE_RUNBOOK, judge_nodes),
        (
            APPLICATIONS_PATH,
            "argocd-application",
            "Argo CD Application이 저장소와 같고 정상이다",
            APPLICATION_RUNBOOK,
            judge_applications,
        ),
    ):
        try:
            items = list_resources(path)
        except Exception as error:  # noqa: BLE001 - 어떤 실패든 사람에게 알린다
            violations.append(
                Violation(
                    key=f"{key}:check-failed",
                    title=f"기대 '{title}'를 평가하지 못했다",
                    runbook=runbook,
                    detail=f"{type(error).__name__}: {error}",
                )
            )
            continue
        violations.extend(judge(items))
    return violations
