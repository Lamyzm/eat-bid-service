"""모듈 책임: 수집이 멈춘 뒤 스스로 이어 가는 실행 층 계약 — 모든 예약의 실행 시간 상한, 자물쇠 풀기 예약과 그 권한의
경계 — 이 운영 manifest에서 어긋나지 않는지 고정한다(EAT-361, ADR 0069)."""

from __future__ import annotations

import importlib.util
from collections.abc import Mapping
from typing import Any

import yaml
from conftest import ManifestSet

RELEASER = "eatbid-lock-release"


def _name(document: Mapping[str, Any]) -> str:
    return str(document["metadata"]["name"])


def test_모든_예약은_실행_시간_상한을_가진다(manifests: ManifestSet) -> None:
    """왜: 2026-10-14~16 수집이 35시간 멈췄다. 예약이 모두 Forbid라 끝나지 않는 회차 하나가 그 예약의 다음 회차를
    전부 지운다. 상한이 없으면 서버가 다시 떠도 이어 가지 않는다."""
    missing: list[str] = []
    for cron in manifests.of_kind("CronWorkflow"):
        workflow_spec = cron["spec"]["workflowSpec"]
        templates = workflow_spec.get("templates") or ()
        bounded = int(workflow_spec.get("activeDeadlineSeconds") or 0) > 0 or (
            templates and all(int(t.get("activeDeadlineSeconds") or 0) > 0 for t in templates)
        )
        if not bounded:
            missing.append(_name(cron))

    assert missing == []


def test_자물쇠_풀기_예약은_전용_계정으로_10분마다_돌고_자물쇠와_비밀을_받지_않는다(
    manifests: ManifestSet,
) -> None:
    """왜: 푸는 쪽이 같은 자물쇠를 기다리거나 DB에 매이면 풀어야 할 때 함께 멈춘다. Forbid면 풀기 회차가 걸린 채
    풀기 자체가 멈추므로 Replace다."""
    cron = manifests.named("CronWorkflow", RELEASER)
    spec = cron["spec"]
    assert spec["suspend"] is False
    assert spec["concurrencyPolicy"] == "Replace"
    assert spec["timezone"] == "Asia/Seoul"
    assert spec["schedules"] == ["1,11,21,31,41,51 * * * *"]

    workflow_spec = spec["workflowSpec"]
    assert workflow_spec["serviceAccountName"] == RELEASER
    assert "workflowTemplateRef" not in workflow_spec
    assert 0 < int(workflow_spec["activeDeadlineSeconds"]) <= 600

    rendered = yaml.safe_dump(cron)
    assert "mutex" not in rendered and "semaphore" not in rendered
    assert "secretKeyRef" not in rendered

    (template,) = workflow_spec["templates"]
    container = template["container"]
    assert str(container["image"]).startswith("ghcr.io/lamyzm/eatbid-dataplane@sha256:")
    assert container["command"] == ["python", "-m", "eatbid.recovery"]
    # 성공한 파드는 곧바로 지워지므로 결과는 출력값으로만 회차에 남는다. 파일 경로가 어긋나면 출력값이 늘 "{}"다.
    assert container["args"] == ["--result-file", "/tmp/eatbid/release.json"]
    (report,) = template["outputs"]["parameters"]
    assert report["valueFrom"]["path"] == "/tmp/eatbid/release.json"
    assert importlib.util.find_spec("eatbid.recovery.__main__") is not None


def test_자물쇠_풀기_권한은_회차_Terminate와_결과_보고_표시뿐이다(manifests: ManifestSet) -> None:
    """왜: 회차를 지우거나 Secret을 읽는 권한이 생기면 회복 도구가 관측 기록을 없애거나 모든 비밀을 쥔다. 이미 끝난
    회차가 남긴 자물쇠는 사람이 보고 지운다(collection-runbook §4.4)."""
    role = manifests.named("Role", RELEASER)
    granted = {
        (resource, verb)
        for rule in role["rules"]
        for resource in rule["resources"]
        for verb in rule["verbs"]
    }
    assert granted == {
        ("workflows", "get"),
        ("workflows", "list"),
        ("workflows", "patch"),
        ("workflowtaskresults", "get"),
        ("workflowtaskresults", "create"),
        ("workflowtaskresults", "patch"),
    }
    assert all(rule["apiGroups"] == ["argoproj.io"] for rule in role["rules"])

    binding = manifests.named("RoleBinding", RELEASER)
    assert binding["roleRef"]["name"] == RELEASER
    assert binding["subjects"] == [{"kind": "ServiceAccount", "name": RELEASER, "namespace": "eatbid"}]
    assert {_name(account) for account in manifests.of_kind("ServiceAccount")} >= {RELEASER}


def test_수집과_감시_계정은_회차를_바꿀_수_없다(manifests: ManifestSet) -> None:
    """왜: 수집 파드와 감시 파드가 쓰는 eatbid-dataplane이 회차 patch를 받으면 어느 파드든 다른 회차를 끊을 수 있다.
    고치는 권한은 풀기 계정 하나에만 둔다."""
    roles = {
        (document["kind"], _name(document)): document
        for kind in ("Role", "ClusterRole")
        for document in manifests.of_kind(kind)
    }
    writable: list[str] = []
    for kind in ("RoleBinding", "ClusterRoleBinding"):
        for binding in manifests.of_kind(kind):
            if not any(subject.get("name") == "eatbid-dataplane" for subject in binding["subjects"]):
                continue
            role = roles.get((binding["roleRef"]["kind"], binding["roleRef"]["name"]))
            if role is None:
                continue
            for rule in role["rules"]:
                if "workflows" in rule["resources"] and set(rule["verbs"]) - {"get", "list", "watch"}:
                    writable.append(_name(role))

    assert writable == []
