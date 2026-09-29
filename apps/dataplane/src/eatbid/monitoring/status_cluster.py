"""모듈 책임: 상태 보고의 백엔드·웹·DB 볼륨·배포 구획 사실을 Kubernetes API 응답과 클러스터 안 HTTP 응답에서 읽어 옮긴다.

왜 DB 질의와 나누는가: Kubernetes 객체의 모양(Deployment·Pod·PVC·Application)과 권한은 DB 스키마와 다른 이유로
바뀐다. 이 모듈이 읽는 경로는 전부 `infra/base/workflows/monitoring-rbac.yaml`이 get·list로만 허락한 것이다.
"""

from __future__ import annotations

import re
from collections.abc import Callable, Mapping, Sequence
from datetime import UTC, datetime
from typing import Any

from .cluster import APPLICATIONS_PATH, ResourceLister
from .status_facts import ApplicationFacts, Unavailable, WorkloadFacts, attempt

HttpProbe = Callable[[str], int]
"""URL 하나를 GET해 상태 코드를 돌려준다. 연결 자체가 안 되면 예외다."""

NAMESPACE = "eatbid"
DEPLOYMENTS_PATH = f"/apis/apps/v1/namespaces/{NAMESPACE}/deployments"
PODS_PATH = f"/api/v1/namespaces/{NAMESPACE}/pods"
PVC_PATH = f"/api/v1/namespaces/{NAMESPACE}/persistentvolumeclaims"
DATABASE_VOLUME = "pgdata"

# 클러스터 안 Service 주소와 각 Deployment의 readinessProbe 경로다(infra/base/app.yaml). kubelet이 보는 것과 같은
# 경로를 Service를 거쳐 한 번 더 묻는다 — 파드가 Ready여도 Service가 엉뚱한 곳을 가리키면 사이트는 죽어 있다.
WORKLOADS: tuple[tuple[str, str], ...] = (
    ("server", f"http://server.{NAMESPACE}.svc/health/ready"),
    ("web", f"http://web.{NAMESPACE}.svc/today"),
)


def _metadata(resource: Mapping[str, Any]) -> Mapping[str, Any]:
    value = resource.get("metadata")
    return value if isinstance(value, Mapping) else {}


def _block(resource: Mapping[str, Any], name: str) -> Mapping[str, Any]:
    value = resource.get(name)
    return value if isinstance(value, Mapping) else {}


def _instant(raw: object) -> datetime | None:
    if not isinstance(raw, str) or not raw:
        return None
    try:
        moment = datetime.fromisoformat(raw)
    except ValueError:
        return None
    return moment if moment.tzinfo is not None else moment.replace(tzinfo=UTC)


def _count(value: object, default: int = 0) -> int:
    return (
        int(value) if isinstance(value, int | str) and str(value).isdigit() else default
    )


def workload_facts(
    name: str,
    deployments: Sequence[Mapping[str, Any]],
    pods: Sequence[Mapping[str, Any]],
    http_status: int | Unavailable,
) -> WorkloadFacts:
    """Deployment 하나의 준비 상태와 그 파드들의 재시작 합계. 파드는 `app` label로 묶는다(infra/base/app.yaml)."""
    deployment = next(
        (item for item in deployments if _metadata(item).get("name") == name), {}
    )
    restarts = 0
    last_restart: datetime | None = None
    for pod in pods:
        labels = _metadata(pod).get("labels")
        if not isinstance(labels, Mapping) or labels.get("app") != name:
            continue
        for container in _block(pod, "status").get("containerStatuses") or ():
            if not isinstance(container, Mapping):
                continue
            restarts += _count(container.get("restartCount"))
            terminated = _block(_block(container, "lastState"), "terminated")
            finished = _instant(terminated.get("finishedAt"))
            if finished is not None and (
                last_restart is None or finished > last_restart
            ):
                last_restart = finished
    return WorkloadFacts(
        name=name,
        ready=_count(_block(deployment, "status").get("readyReplicas")),
        # Deployment가 목록에 없으면 기대 1, 준비 0이다. 없어진 Deployment는 정상이 아니다.
        desired=_count(_block(deployment, "spec").get("replicas"), default=1),
        restarts=restarts,
        last_restart_at=last_restart,
        http_status=http_status,
    )


def _http_status(probe: HttpProbe | None, url: str) -> int | Unavailable:
    if probe is None:
        return Unavailable("HTTP 조회 수단 없음")
    return attempt(lambda: probe(url))


def collect_workloads(
    list_resources: ResourceLister, probe: HttpProbe | None
) -> tuple[WorkloadFacts, ...]:
    deployments = list_resources(DEPLOYMENTS_PATH)
    pods = list_resources(PODS_PATH)
    return tuple(
        workload_facts(name, deployments, pods, _http_status(probe, url))
        for name, url in WORKLOADS
    )


_QUANTITY = re.compile(r"^(\d+)(Ki|Mi|Gi|Ti|K|M|G|T)?$")
_UNITS: Mapping[str | None, int] = {
    None: 1,
    "K": 1000,
    "M": 1000**2,
    "G": 1000**3,
    "T": 1000**4,
    "Ki": 1024,
    "Mi": 1024**2,
    "Gi": 1024**3,
    "Ti": 1024**4,
}


def parse_quantity(text: str) -> int:
    """Kubernetes 용량 표기를 바이트로. 정수 표기만 받는다 — 소수·지수 표기는 PVC 용량에 쓰이지 않고, 모르는 꼴을
    어림하면 틀린 사용률이 정상처럼 보인다."""
    match = _QUANTITY.match(text.strip())
    if match is None:
        raise ValueError(f"읽을 수 없는 용량 표기: {text}")
    return int(match.group(1)) * _UNITS[match.group(2)]


def database_volume_bytes(list_resources: ResourceLister) -> int:
    """DB 볼륨(PVC)이 받은 용량. 실제 디스크 사용량은 kubelet 통계(nodes/proxy)에서만 나오는데, 그 권한은 노드의
    모든 파드에 명령을 보낼 수 있는 넓은 권한이라 감시에 주지 않는다 — 그래서 사용률은 DB 크기 대비로만 말한다."""
    for claim in list_resources(PVC_PATH):
        if _metadata(claim).get("name") == DATABASE_VOLUME:
            capacity = _block(_block(claim, "status"), "capacity").get("storage")
            return parse_quantity(str(capacity))
    raise LookupError(f"PVC {DATABASE_VOLUME} 없음")


def short_image(image: str) -> str:
    """`ghcr.io/lamyzm/eatbid-server@sha256:0c6c…`를 `eatbid-server@sha256:0c6c0292fd12`로. 운영 이미지는 태그 없이
    digest로 고정되므로(ADR 0051) digest 앞 12자리가 릴리스를 가리키는 가장 짧은 식별이다."""
    name, _, digest = image.rpartition("@")
    if not name:
        return image.rsplit("/", 1)[-1]
    return f"{name.rsplit('/', 1)[-1]}@{digest[: len('sha256:') + 12]}"


def collect_applications(
    list_resources: ResourceLister,
) -> tuple[ApplicationFacts, ...]:
    facts: list[ApplicationFacts] = []
    for application in list_resources(APPLICATIONS_PATH):
        status = _block(application, "status")
        sync = _block(status, "sync")
        images = _block(status, "summary").get("images") or ()
        facts.append(
            ApplicationFacts(
                name=str(_metadata(application).get("name") or "unknown"),
                sync=str(sync.get("status") or "unknown"),
                health=str(_block(status, "health").get("status") or "unknown"),
                revision=str(sync["revision"]) if sync.get("revision") else None,
                images=tuple(
                    sorted(
                        short_image(str(image))
                        for image in images
                        if "eatbid-" in str(image)
                    )
                ),
            )
        )
    return tuple(sorted(facts, key=lambda item: item.name))
