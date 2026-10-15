"""모듈 책임: 끝난 단계가 쥔 Argo 자물쇠를 풀어 그 자물쇠를 기다리던 수집 회차가 사람 손 없이 이어 가게 한다(EAT-361).

왜 필요한가: 재시작 때 단계 파드의 wait 컨테이너가 결과 보고를 끝내지 못하고 죽으면 Argo(v4.0.8)는 그 단계의
WorkflowTaskResult를 미완료로 남긴다. 컨트롤러는 "완료로 표시한다"고 로그에 적지만 저장하지 않아, 단계는 실패했는데
끝나지 않은 노드가 되고 회차는 Running인 채 mutex를 reconcile마다 다시 잡는다. 실행 시간 상한(activeDeadlineSeconds)도
이 노드를 끝내지 못한다 — 2026-10-16 로컬 Argo에서 재현해 확인했다. 운영에서는 2026-10-14부터 35시간 수집이 멈췄다.

어떻게 푸는가: runbook §4.4와 같은 Terminate를 걸고, 보유 단계의 결과 보고가 미완료면 완료로 표시한다. DAG 회차는
Terminate만으로 풀렸지만 Steps 회차는 보고 표시까지 해야 풀렸으므로 둘 다 한다. 보고 표시는 컨트롤러가 하겠다고
로그에 적은 동작을 대신 마무리하는 것이다. 끊는 대상은 보유 단계가 이미 끝난 회차뿐이라, 이 회차는 어차피 실패로
끝난다 — 끊어서 잃는 것이 없다. 이미 끝난 회차가 자물쇠를 남긴 꼴은 회차를 지우고 컨트롤러를 다시 띄워야 해서 사람에게
남긴다(감시가 critical로 알린다).

왜 감시와 따로 두는가: 감시 ServiceAccount는 쓰기 동사가 하나도 없다 — 감시가 감시 대상을 바꾸는 자리가 되면 안 된다.
풀기는 회차 patch만 받는 별도 ServiceAccount로, 별도 예약에서 돈다.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Protocol

from eatbid.monitoring.stuck_locks import (
    StuckLock,
    find_stuck_locks,
    orphan_waiters,
    terminate_patch,
)

__all__ = [
    "NUDGE_ANNOTATION",
    "REPORT_COMPLETED_LABEL",
    "TASK_RESULTS_PATH",
    "WORKFLOWS_PATH",
    "ReleaseReport",
    "WorkflowApi",
    "release_stuck_locks",
]

WORKFLOWS_PATH = "/apis/argoproj.io/v1alpha1/namespaces/eatbid/workflows"
TASK_RESULTS_PATH = "/apis/argoproj.io/v1alpha1/namespaces/eatbid/workflowtaskresults"
# Argo가 단계 결과 보고를 끝냈는지 판정하는 표시다. WorkflowTaskResult 이름은 노드 ID와 같다.
REPORT_COMPLETED_LABEL = "workflows.argoproj.io/report-outputs-completed"
# 기다리던 회차를 다시 조정하게 하는 표시다. 값이 바뀌면 컨트롤러가 그 회차를 다시 처리한다(runbook §4.4 2단계와 같다).
NUDGE_ANNOTATION = "eatbid.dev/nudge"


class WorkflowApi(Protocol):
    def list_items(self, path: str) -> list[Mapping[str, Any]]: ...
    def get(self, path: str) -> Mapping[str, Any] | None: ...
    def merge_patch(self, path: str, body: Mapping[str, Any]) -> None: ...


@dataclass(frozen=True, slots=True)
class ReleaseReport:
    """한 회차의 결과다. `failures`가 있으면 예약이 실패로 끝나 감시가 cron 실패로 알린다."""

    terminated: tuple[str, ...] = ()
    completed_reports: tuple[str, ...] = ()
    left_for_human: tuple[str, ...] = ()
    nudged: tuple[str, ...] = ()
    failures: tuple[str, ...] = ()

    def as_json(self) -> dict[str, Any]:
        return {
            "terminated": list(self.terminated),
            "completed_reports": list(self.completed_reports),
            "left_for_human": list(self.left_for_human),
            "nudged": list(self.nudged),
            "failures": list(self.failures),
        }


def _shutdown(workflows: Sequence[Mapping[str, Any]], name: str) -> str | None:
    for workflow in workflows:
        metadata = workflow.get("metadata")
        if isinstance(metadata, Mapping) and metadata.get("name") == name:
            spec = workflow.get("spec")
            value = spec.get("shutdown") if isinstance(spec, Mapping) else None
            return value if isinstance(value, str) else None
    return None


def _complete_report(api: WorkflowApi, stuck: StuckLock) -> bool:
    """보유 단계의 결과 보고가 미완료면 완료로 표시한다. 표시했으면 True다."""
    parts = stuck.holder.split("/")
    if len(parts) < 3:
        return False
    path = f"{TASK_RESULTS_PATH}/{parts[2]}"
    task_result = api.get(path)
    if task_result is None:
        return False
    metadata = task_result.get("metadata")
    labels = metadata.get("labels") if isinstance(metadata, Mapping) else None
    if isinstance(labels, Mapping) and labels.get(REPORT_COMPLETED_LABEL) == "true":
        return False
    api.merge_patch(path, {"metadata": {"labels": {REPORT_COMPLETED_LABEL: "true"}}})
    return True


def release_stuck_locks(api: WorkflowApi, *, now: datetime) -> ReleaseReport:
    """죽은 보유를 찾아 풀 수 있는 것은 풀고, 아닌 것은 이름만 돌려준다. 주인이 놓은 자물쇠를 아직 기다리는 회차는 깨운다.

    한 회차의 patch가 실패해도 나머지는 계속 푼다. 한 곳의 권한 오류가 다른 자물쇠까지 묶어 두면 안 된다. 이번에 끊은
    회차의 자물쇠는 컨트롤러가 처리한 뒤에 풀리므로, 그 대기자는 스스로 깨어나지 않았으면 다음 회차가 깨운다.
    """
    workflows = api.list_items(WORKFLOWS_PATH)
    terminated: list[str] = []
    completed: list[str] = []
    left: list[str] = []
    failures: list[str] = []
    for stuck in find_stuck_locks(workflows, now=now):
        if not stuck.releasable:
            if stuck.workflow not in left:
                left.append(stuck.workflow)
            continue
        try:
            if stuck.workflow not in terminated and _shutdown(workflows, stuck.workflow) != "Terminate":
                api.merge_patch(f"{WORKFLOWS_PATH}/{stuck.workflow}", terminate_patch())
            if stuck.workflow not in terminated:
                terminated.append(stuck.workflow)
            if _complete_report(api, stuck):
                completed.append(stuck.holder)
        except Exception as error:  # noqa: BLE001 - 어떤 실패든 이름을 남기고 다음 자물쇠로 간다
            failures.append(f"{stuck.workflow}: {type(error).__name__}: {error}")
    nudged: list[str] = []
    for name in orphan_waiters(workflows):
        try:
            api.merge_patch(
                f"{WORKFLOWS_PATH}/{name}",
                {"metadata": {"annotations": {NUDGE_ANNOTATION: now.isoformat()}}},
            )
            nudged.append(name)
        except Exception as error:  # noqa: BLE001 - 어떤 실패든 이름을 남기고 다음 회차로 간다
            failures.append(f"{name}: {type(error).__name__}: {error}")
    return ReleaseReport(
        terminated=tuple(terminated),
        completed_reports=tuple(completed),
        left_for_human=tuple(left),
        nudged=tuple(nudged),
        failures=tuple(failures),
    )
