"""모듈 책임: Argo 회차가 쥔 자물쇠(mutex·semaphore)를 보유 단계가 이미 끝났는데도 놓지 않은 "죽은 보유"를 Workflow 상태만 보고 가려낸다.

왜: 2026-10-14 17:29 클러스터 재시작이 replay-advance 회차의 작업 파드를 죽였는데, Argo(v4.0.8)는 그 회차를 Running으로 둔 채
reconcile마다 `eatbid-core-publication` mutex를 다시 잡았다. 같은 mutex를 기다린 공고 수집·개찰 결과·아침 정리·백필이 줄을
섰고, cron이 모두 `concurrencyPolicy: Forbid`라 그 뒤 회차가 35시간 만들어지지 않았다(EAT-361). 9-10·9-19에도 같은 꼴이었다.

왜 판정을 따로 두는가: 감시(알림)와 자물쇠 풀기(`release-stuck-locks`)가 같은 경계를 써야 "알렸는데 안 풀었다"나 "풀었는데
몰랐다"가 생기지 않는다. 경계는 클러스터 없이 고정할 수 있게 순수 함수로 둔다.
"""

from __future__ import annotations

import base64
import gzip
import json
from collections.abc import Iterator, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

__all__ = ["STUCK_GRACE", "StuckLock", "find_stuck_locks", "orphan_waiters", "terminate_patch"]

STUCK_GRACE = timedelta(minutes=10)
"""보유 단계가 끝난 뒤 이만큼 지나도 자물쇠를 쥐고 있으면 죽은 보유로 본다.

정상이면 단계가 끝난 다음 reconcile(수 초)에 풀린다. 10분은 컨트롤러가 밀려 있는 순간을 죽은 보유로 오판하지 않을 만큼
넉넉하고, 공고 수집 주기(10분)를 하나 넘기기 전에 푸는 값이다.
"""

_CRON_LABEL = "workflows.argoproj.io/cron-workflow"
_ENDED_NODE_PHASES: frozenset[str] = frozenset({"Failed", "Error", "Succeeded", "Skipped", "Omitted"})
_ENDED_WORKFLOW_PHASES: frozenset[str] = frozenset({"Failed", "Error", "Succeeded"})


@dataclass(frozen=True, slots=True)
class StuckLock:
    """죽은 보유 하나다. `releasable`이면 회차를 Terminate해 풀 수 있다."""

    workflow: str
    cron: str | None
    lock: str
    holder: str
    holder_phase: str
    since: datetime | None
    releasable: bool


def terminate_patch() -> dict[str, Any]:
    """회차를 끝내는 merge patch다. runbook §4.4 1단계와 같은 값이며, Argo가 남은 노드를 끝내고 자물쇠를 놓는다."""
    return {"spec": {"shutdown": "Terminate"}}


def _mapping(value: object) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def _moment(value: object) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        moment = datetime.fromisoformat(value)
    except ValueError:
        return None
    return moment if moment.tzinfo is not None else moment.replace(tzinfo=UTC)


def _nodes(status: Mapping[str, Any]) -> Mapping[str, Any]:
    """노드 목록이다. 큰 회차는 Argo가 `compressedNodes`(gzip + base64 JSON)로 접어 두므로 그것도 편다."""
    nodes = status.get("nodes")
    if isinstance(nodes, Mapping) and nodes:
        return nodes
    compressed = status.get("compressedNodes")
    if isinstance(compressed, str) and compressed:
        try:
            decoded = json.loads(gzip.decompress(base64.b64decode(compressed)))
        except (ValueError, OSError):
            return {}
        return decoded if isinstance(decoded, Mapping) else {}
    return {}


def _holdings(synchronization: Mapping[str, Any]) -> Iterator[tuple[str, str]]:
    """(자물쇠 이름, 보유자) 쌍이다. 보유자는 `namespace/workflow/nodeId`이고, 회차 단위 자물쇠면 nodeId가 없다."""
    for entry in _mapping(synchronization.get("mutex")).get("holding") or ():
        entry = _mapping(entry)
        lock = entry.get("mutex")
        holder = entry.get("holder")
        if isinstance(lock, str) and isinstance(holder, str):
            yield lock, holder
    for entry in _mapping(synchronization.get("semaphore")).get("holding") or ():
        entry = _mapping(entry)
        lock = entry.get("semaphore")
        if not isinstance(lock, str):
            continue
        for holder in entry.get("holders") or ():
            if isinstance(holder, str):
                yield lock, holder


def orphan_waiters(workflows: Sequence[Mapping[str, Any]]) -> list[str]:
    """기다리는 자물쇠의 주인이 이미 그것을 놓았는데도 아직 기다리는 Running 회차 이름이다.

    자물쇠가 풀려도 기다리던 회차가 다시 시도하지 않은 적이 있다(2026-09-10, collection-runbook §4.4 2단계). 대기
    기록에 적힌 주인 가운데 누구도 지금 그 자물쇠를 쥐고 있지 않을 때만 고른다 — 주인이 살아 있는 정상 대기는 건드리지
    않는다. 주인이 적혀 있지 않은 대기는 판단할 근거가 없어 고르지 않는다.
    """
    held = {
        pair
        for workflow in workflows
        for pair in _holdings(_mapping(_mapping(workflow.get("status")).get("synchronization")))
    }
    names: list[str] = []
    for workflow in workflows:
        name = _mapping(workflow.get("metadata")).get("name")
        status = _mapping(workflow.get("status"))
        if not isinstance(name, str) or status.get("phase") != "Running":
            continue
        synchronization = _mapping(status.get("synchronization"))
        # 같은 자물쇠를 이미 쥔 회차의 대기 기록은 지나간 기록이다. 그 회차는 기다리고 있지 않다(2026-10-16 로컬 재현).
        own = {lock for lock, holder in _holdings(synchronization) if holder.split("/")[1:2] == [name]}
        waits: list[tuple[Any, list[Any]]] = [
            (_mapping(entry).get("mutex"), [_mapping(entry).get("holder")])
            for entry in _mapping(synchronization.get("mutex")).get("waiting") or ()
        ] + [
            (_mapping(entry).get("semaphore"), list(_mapping(entry).get("holders") or ()))
            for entry in _mapping(synchronization.get("semaphore")).get("waiting") or ()
        ]
        for lock, holders in waits:
            owners = [holder for holder in holders if isinstance(holder, str) and holder]
            if lock in own:
                continue
            if isinstance(lock, str) and owners and all((lock, owner) not in held for owner in owners):
                names.append(name)
                break
    return names


def find_stuck_locks(
    workflows: Sequence[Mapping[str, Any]], *, now: datetime, grace: timedelta = STUCK_GRACE
) -> list[StuckLock]:
    """죽은 보유만 돌려준다.

    두 꼴이 있다.
    - 회차는 Running인데 자물쇠를 쥔 노드가 끝났다(2026-10-14 꼴). Terminate로 풀린다.
    - 회차가 이미 끝났는데 자물쇠가 남아 있다(2026-09-20 꼴). Terminate할 것이 없어 사람이 회차를 지우고 컨트롤러를 다시
      띄워야 한다(runbook §4.4 마지막 단계). 기계는 지우지 않는다 — 지우는 것은 관측 기록을 없애는 일이라 사람이 본다.

    보유 노드를 status에서 못 찾으면 판정하지 않는다. 모르는 것을 죽었다고 부르면 살아 있는 회차를 끊는다.
    """
    stuck: list[StuckLock] = []
    for workflow in workflows:
        metadata = _mapping(workflow.get("metadata"))
        name = metadata.get("name")
        if not isinstance(name, str) or not name:
            continue
        labels = _mapping(metadata.get("labels"))
        cron = labels.get(_CRON_LABEL) if isinstance(labels.get(_CRON_LABEL), str) else None
        status = _mapping(workflow.get("status"))
        phase = str(status.get("phase") or "")
        nodes = _nodes(status)
        for lock, holder in _holdings(_mapping(status.get("synchronization"))):
            parts = holder.split("/")
            if len(parts) >= 2 and parts[1] != name:
                continue
            if phase in _ENDED_WORKFLOW_PHASES:
                since = _moment(status.get("finishedAt"))
                if since is not None and now - since < grace:
                    continue
                stuck.append(StuckLock(name, cron, lock, holder, phase, since, releasable=False))
                continue
            if len(parts) < 3:
                continue
            node = _mapping(nodes.get(parts[2]))
            node_phase = str(node.get("phase") or "")
            if node_phase not in _ENDED_NODE_PHASES:
                continue
            # 죽은 파드의 노드는 끝난 시각이 비어 있을 수 있다(10-14 회차가 그랬다). 그때는 시작 시각부터 잰다.
            since = _moment(node.get("finishedAt")) or _moment(node.get("startedAt"))
            if since is None or now - since < grace:
                continue
            stuck.append(StuckLock(name, cron, lock, holder, node_phase, since, releasable=True))
    return stuck
