"""모듈 책임: 노드·Argo CD Application·cron 회차가 정상인지를 Kubernetes API가 준 상태만 보고 판정한다.

왜 이 셋인가: 전부 DB에 흔적을 남기지 않는 사고다. 2026-09-10에 옛 VM 노드가 28시간 죽어 있었고 사용자가
물어서 알았다 — 노드가 죽으면 이상한 행이 생기는 게 아니라 새 행이 안 생긴다. Application은 저장소와
클러스터가 벌어진 것을 Argo CD가 이미 계산해 둔 답이다. cron 회차는 기동 전에 죽으면 `ingest.run`조차
만들지 못한다(2026-09-14 전진 cron이 설정 검증에서 exit 64).

왜 판정이 순수 함수인가: Ready·Synced·실패의 경계는 클러스터 없이 검증할 수 있어야 한다. 조회는
호출자가 넣는다.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from datetime import UTC, datetime, timedelta
from typing import Any

from .expectations import Violation

__all__ = [
    "APPLICATION_RUNBOOK",
    "CRON_FAILURE_WINDOW",
    "CRON_RUNBOOK",
    "NODE_RUNBOOK",
    "ResourceLister",
    "evaluate_cluster",
    "judge_applications",
    "judge_cron_workflows",
    "judge_nodes",
]

NODE_RUNBOOK = "docs/operations/k3s-hyperv-vm.md"
APPLICATION_RUNBOOK = "docs/operations/ci-gate-failure-response.md"
CRON_RUNBOOK = "docs/operations/collection-runbook.md"

ResourceLister = Callable[[str], Sequence[Mapping[str, Any]]]
"""API 경로 하나를 받아 그 목록의 `items`를 돌려준다. 경로를 문자열로 두는 이유는 노드와 Application이
서로 다른 API group에 있고, 그 차이를 이 모듈이 알 필요가 없기 때문이다."""

NODES_PATH = "/api/v1/nodes"
APPLICATIONS_PATH = "/apis/argoproj.io/v1alpha1/namespaces/argocd/applications"
WORKFLOWS_PATH = "/apis/argoproj.io/v1alpha1/namespaces/eatbid/workflows"

CRON_LABEL = "workflows.argoproj.io/cron-workflow"
LIVE_CRON = "eatbid-poll-open"

# 실패한 회차가 이 시간 안에 만들어졌을 때만 위반으로 본다. 임의의 여유가 아니라 보존 정책이 강제하는
# 값이다: 성공은 1시간, 실패는 24시간 남는다(ttlStrategy). 그래서 "남아 있는 것 중 가장 최근이 실패"는
# 시간이 지나면 반드시 참이 된다 — 뒤따른 성공들이 먼저 지워지기 때문이다. 실제로 2026-09-14 21시에
# poll-open은 05:50 실패 하나만 남아 있었고 그 뒤 성공 수십 회차는 이미 GC됐다.
# 두 시간이면 매시 cron의 마지막 회차를 놓치지 않으면서 그 편향에 걸리지 않는다.
CRON_FAILURE_WINDOW = timedelta(hours=2)

_FAILED_PHASES: frozenset[str] = frozenset({"Failed", "Error"})


def _name(resource: Mapping[str, Any]) -> str:
    metadata = resource.get("metadata")
    if isinstance(metadata, Mapping):
        return str(metadata.get("name") or "unknown")
    return "unknown"


def _metadata(resource: Mapping[str, Any]) -> Mapping[str, Any]:
    metadata = resource.get("metadata")
    return metadata if isinstance(metadata, Mapping) else {}


def _created_at(resource: Mapping[str, Any]) -> datetime | None:
    raw = _metadata(resource).get("creationTimestamp")
    if not isinstance(raw, str) or not raw:
        return None
    try:
        moment = datetime.fromisoformat(raw)
    except ValueError:
        return None
    return moment if moment.tzinfo is not None else moment.replace(tzinfo=UTC)


def judge_cron_workflows(
    workflows: Sequence[Mapping[str, Any]],
    *,
    now: datetime,
) -> list[Violation]:
    """cron마다 가장 최근 회차 하나를 보고, 그것이 최근에 실패했으면 위반으로 돌려준다.

    cron 라벨이 없는 Workflow는 보지 않는다. 사람이 직접 제출한 한 번짜리 실행이라 다음 회차라는 것이
    없고, 실패했다면 제출한 사람이 그 자리에서 본다.

    회차가 하나도 안 남은 cron은 위반이 아니다. 성공이 TTL로 지워진 것과 한 번도 안 돈 것을 여기서는
    구분할 수 없고, 구분할 수 없는 것을 위반이라 부르면 매일 울린다. 회차를 아예 건너뛰는 사고는
    `capture-freshness` 기대가 DB 쪽에서 따로 본다.
    """
    latest: dict[str, Mapping[str, Any]] = {}
    for workflow in workflows:
        labels = _metadata(workflow).get("labels")
        cron = labels.get(CRON_LABEL) if isinstance(labels, Mapping) else None
        if not isinstance(cron, str) or not cron:
            continue
        created = _created_at(workflow)
        if created is None:
            continue
        current = latest.get(cron)
        if current is None or created > (_created_at(current) or created):
            latest[cron] = workflow

    violations: list[Violation] = []
    for cron, workflow in sorted(latest.items()):
        status = workflow.get("status")
        phase = str(status.get("phase") or "") if isinstance(status, Mapping) else ""
        if phase not in _FAILED_PHASES:
            continue
        created = _created_at(workflow)
        if created is None or now - created >= CRON_FAILURE_WINDOW:
            continue
        message = ""
        if isinstance(status, Mapping):
            message = str(status.get("message") or "")
        violations.append(
            Violation(
                key=f"cron-workflow:{cron}",
                title=f"{cron}의 최근 회차가 끝까지 갔다",
                runbook=CRON_RUNBOOK,
                detail=f"회차={_name(workflow)}, 상태={phase}, 사유={message or 'unknown'}",
                # 실시간 수집 회차만 critical이다. 전진·백업·감시 회차의 실패는 다음 회차나 다른 기대가 받고,
                # poll-open이 멈추면 오늘의 공고가 화면에 없다(ADR 0054 결정 1).
                severity="critical" if cron == LIVE_CRON else "normal",
            )
        )
    return violations


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
                severity="critical",
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
                    severity="critical",
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
                    severity="critical",
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
                severity="critical",
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
                    severity="critical",
                )
            )
    return violations


def evaluate_cluster(
    list_resources: ResourceLister, *, now: datetime | None = None
) -> list[Violation]:
    """노드·Application·cron 회차를 조회해 위반만 돌려준다.

    셋을 따로 감싸는 이유는 한쪽 조회가 막혀도 나머지 판정은 살아야 하기 때문이다. Application 읽기
    권한만 빠져 있을 때 노드 상태까지 함께 모르는 상태가 되면 안 된다.
    """
    moment = now or datetime.now(UTC)
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
        (
            WORKFLOWS_PATH,
            "cron-workflow",
            "cron의 최근 회차가 끝까지 갔다",
            CRON_RUNBOOK,
            lambda items: judge_cron_workflows(items, now=moment),
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
