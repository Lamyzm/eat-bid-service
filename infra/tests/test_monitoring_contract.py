"""모듈 책임: 감시(check-expectations)가 코드에 적어 둔 클러스터 사실 — 읽기 권한, 정시 수집 schedule, cron 이름,
서버·웹 주소 — 이 운영 manifest와 어긋나지 않는지 고정한다."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from conftest import ManifestSet
from eatbid.monitoring.cluster_explanations import CRON_IMPACTS
from eatbid.monitoring.report_schedule import (
    POLL_OPEN_EVERY_MINUTES,
    POLL_OPEN_HOURS,
    POLL_OPEN_ISO_WEEKDAYS,
    POLL_OPEN_SCHEDULE,
)
from eatbid.monitoring.status_cluster import (
    DATABASE_VOLUME,
    NAMESPACE,
    WORKLOADS,
)

MONITORING_SUBJECT = {
    "kind": "ServiceAccount",
    "name": "eatbid-dataplane",
    "namespace": "eatbid",
}


def _name(document: Mapping[str, Any]) -> str:
    return str(document["metadata"]["name"])


def _monitoring_roles(manifests: ManifestSet) -> list[Mapping[str, Any]]:
    return [
        role
        for kind in ("Role", "ClusterRole")
        for role in manifests.of_kind(kind)
        if _name(role).startswith("eatbid-monitoring-")
    ]


def test_감시_권한은_읽기_동사만_갖고_Secret을_읽지_않는다(
    manifests: ManifestSet,
) -> None:
    """왜: 감시는 사람에게 말할 뿐 고치지 않는다. 쓰기 동사가 생기면 언젠가 자동 복구가 여기에 들어오고, Secret을
    읽으면 감시 파드 하나가 모든 비밀을 쥔다(monitoring-rbac.yaml)."""
    roles = _monitoring_roles(manifests)
    assert roles, "감시 Role이 렌더에 없다"
    for role in roles:
        for rule in role["rules"]:
            assert set(rule["verbs"]) <= {"get", "list"}, (_name(role), rule)
            assert "secrets" not in rule["resources"], (_name(role), rule)
            assert "*" not in rule["resources"], (_name(role), rule)


def test_상태_보고가_읽는_작업_객체를_eatbid_namespace_안에서만_읽을_수_있다(
    manifests: ManifestSet,
) -> None:
    """왜: 권한이 빠지면 보고의 백엔드·웹·DB 구획이 매번 "확인 못 함"이 되고, 그것은 오류가 아니라 조용한 공백이다.
    넓히더라도 ClusterRole이 아니라 namespace 안 Role이어야 한다(EAT-299)."""
    role = manifests.named("Role", "eatbid-monitoring-read-workloads")
    assert role["metadata"]["namespace"] == NAMESPACE
    granted = {
        (group, resource)
        for rule in role["rules"]
        for group in rule["apiGroups"]
        for resource in rule["resources"]
    }
    assert granted == {
        ("apps", "deployments"),
        ("", "pods"),
        ("", "persistentvolumeclaims"),
    }
    binding = manifests.named("RoleBinding", "eatbid-monitoring-read-workloads")
    assert binding["roleRef"]["name"] == "eatbid-monitoring-read-workloads"
    assert binding["subjects"] == [MONITORING_SUBJECT]


def test_정시_수집_계획_수는_manifest의_schedule과_같은_규칙으로_센다(
    manifests: ManifestSet,
) -> None:
    """왜: 건너뛴 예약 수는 "계획 − 실행"이다. 주기를 바꾼 커밋이 이 상수를 놓치면 보고가 매일 틀린 수를 말한다."""
    poll_open = manifests.named("CronWorkflow", "eatbid-poll-open")
    assert poll_open["spec"]["schedules"] == [POLL_OPEN_SCHEDULE]
    assert poll_open["spec"]["timezone"] == "Asia/Seoul"
    minute, hour, _, _, weekday = POLL_OPEN_SCHEDULE.split()
    assert minute == f"*/{POLL_OPEN_EVERY_MINUTES}"
    first_hour, last_hour = (int(part) for part in hour.split("-"))
    assert range(first_hour, last_hour + 1) == POLL_OPEN_HOURS
    first_day, last_day = (int(part) for part in weekday.split("-"))
    assert range(first_day, last_day + 1) == POLL_OPEN_ISO_WEEKDAYS


def test_모든_CronWorkflow는_실패했을_때_사람에게_할_영향_문장을_갖는다(
    manifests: ManifestSet,
) -> None:
    """왜: 새 cron을 더하고 문장을 빠뜨리면 그 cron의 실패 알림이 "영향: 확인 못 함"으로 나간다."""
    names = {_name(cron) for cron in manifests.of_kind("CronWorkflow")}
    assert names <= set(CRON_IMPACTS), sorted(names - set(CRON_IMPACTS))


def test_상태_보고가_묻는_서버_웹_주소는_Service와_readinessProbe_경로와_같다(
    manifests: ManifestSet,
) -> None:
    """왜: 주소나 경로가 어긋나면 보고가 매번 "응답 없음"을 말하고, 사람은 곧 그 줄을 무시하게 된다."""
    for name, url in WORKLOADS:
        service = manifests.named("Service", name)
        assert service["metadata"]["namespace"] == NAMESPACE
        assert [port["port"] for port in service["spec"]["ports"]] == [80]
        deployment = manifests.named("Deployment", name)
        container = deployment["spec"]["template"]["spec"]["containers"][0]
        path = container["readinessProbe"]["httpGet"]["path"]
        assert url == f"http://{name}.{NAMESPACE}.svc{path}"


def test_DB_볼륨_이름은_postgres가_쓰는_PVC와_같다(manifests: ManifestSet) -> None:
    claim = manifests.named("PersistentVolumeClaim", DATABASE_VOLUME)
    assert claim["metadata"]["namespace"] == NAMESPACE
