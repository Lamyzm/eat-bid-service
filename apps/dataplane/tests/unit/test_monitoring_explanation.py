"""모듈 책임: 운영 경로(기대·클러스터·백업·GitHub)가 만드는 모든 위반이 사람 말 설명을 빠짐없이 들고 나오는지 고정한다."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

from eatbid.monitoring.backup import (
    BACKUP_EXPECTATIONS,
    BackupObject,
    evaluate_backups,
)
from eatbid.monitoring.cluster import (
    APPLICATIONS_PATH,
    NODES_PATH,
    WORKFLOWS_PATH,
    evaluate_cluster,
)
from eatbid.monitoring.cluster_explanations import CRON_IMPACTS
from eatbid.monitoring.expectations import EXPECTATIONS, Violation, evaluate
from eatbid.monitoring.explanation import TODAY, URGENT_NOW, urgency_for
from eatbid.monitoring.github import GITHUB_EXPECTATIONS, evaluate_workflows

_지금 = datetime(2026, 9, 29, 3, 0, tzinfo=UTC)


def _설명이_온전하다(violations: Sequence[Violation]) -> None:
    assert violations, "검사할 위반이 하나도 안 만들어졌다"
    for violation in violations:
        explanation = violation.explanation
        assert explanation is not None, violation.key
        assert explanation.what.strip() and explanation.impact.strip(), violation.key
        # 급함은 재알림 정책과 같은 말을 해야 한다. critical인데 "오늘 안에"라고 쓰면 사람이 늦게 움직인다.
        assert explanation.urgency == urgency_for(violation.severity), violation.key


def test_선언된_기대는_모두_무슨_일과_영향을_사람_말로_갖는다() -> None:
    for expectation in EXPECTATIONS:
        assert expectation.what.strip(), expectation.key
        assert expectation.impact.strip(), expectation.key
        assert "=" not in expectation.what + expectation.impact, expectation.key


def test_기대가_낸_위반과_평가_실패_위반_모두_설명을_든다() -> None:
    def 행을_주는_질의(
        _sql: str, _parameters: Mapping[str, Any]
    ) -> Sequence[Mapping[str, Any]]:
        return [{"run_id": "r1", "window_start": "20260101", "window_end": "20260131"}]

    def 깨지는_질의(
        _sql: str, _parameters: Mapping[str, Any]
    ) -> Sequence[Mapping[str, Any]]:
        raise RuntimeError("DB 없음")

    _설명이_온전하다(evaluate(행을_주는_질의))
    실패 = evaluate(깨지는_질의)
    _설명이_온전하다(실패)
    assert len(실패) == len(EXPECTATIONS)


def _목록(**경로별: Sequence[Mapping[str, Any]]):
    paths = {
        "nodes": NODES_PATH,
        "apps": APPLICATIONS_PATH,
        "workflows": WORKFLOWS_PATH,
    }

    def list_resources(path: str) -> Sequence[Mapping[str, Any]]:
        for name, items in 경로별.items():
            if paths[name] == path:
                return items
        raise PermissionError("403")

    return list_resources


def test_클러스터_판정의_모든_갈래가_설명을_든다() -> None:
    나쁜_노드 = [
        {
            "metadata": {"name": "vm1"},
            "status": {"conditions": [{"type": "Ready", "status": "False"}]},
        },
        {
            "metadata": {"name": "vm2"},
            "status": {"conditions": [{"type": "Ready", "status": "True"}]},
            "spec": {"unschedulable": True},
        },
    ]
    어긋난_앱 = [
        {
            "metadata": {"name": "eatbid-prod"},
            "status": {"sync": {"status": "OutOfSync"}},
        }
    ]
    실패한_회차 = [
        {
            "metadata": {
                "name": f"{cron}-1",
                "labels": {"workflows.argoproj.io/cron-workflow": cron},
                "creationTimestamp": (_지금 - timedelta(minutes=10)).isoformat(),
            },
            "status": {"phase": "Failed"},
        }
        for cron in CRON_IMPACTS
    ]

    판정 = evaluate_cluster(
        _목록(nodes=나쁜_노드, apps=어긋난_앱, workflows=실패한_회차), now=_지금
    )
    빈_클러스터 = evaluate_cluster(_목록(nodes=[], apps=[], workflows=[]), now=_지금)
    권한_없음 = evaluate_cluster(_목록(), now=_지금)

    _설명이_온전하다(판정)
    _설명이_온전하다(빈_클러스터)
    _설명이_온전하다(권한_없음)
    assert {v.key.split(":")[0] for v in 권한_없음} == {
        "node-health",
        "argocd-application",
        "cron-workflow",
    }
    cron_위반 = [v for v in 판정 if v.key.startswith("cron-workflow:")]
    assert len(cron_위반) == len(CRON_IMPACTS)
    assert all(
        "확인 못 함" not in v.explanation.impact for v in cron_위반 if v.explanation
    )


def test_실시간_수집_cron만_지금_봐야_함이고_나머지는_오늘_안이다() -> None:
    판정 = evaluate_cluster(
        _목록(
            nodes=[
                {
                    "metadata": {"name": "vm"},
                    "status": {"conditions": [{"type": "Ready", "status": "True"}]},
                }
            ],
            apps=[
                {
                    "metadata": {"name": "a"},
                    "status": {
                        "sync": {"status": "Synced"},
                        "health": {"status": "Healthy"},
                    },
                }
            ],
            workflows=[
                {
                    "metadata": {
                        "name": f"{cron}-1",
                        "labels": {"workflows.argoproj.io/cron-workflow": cron},
                        "creationTimestamp": (_지금 - timedelta(minutes=5)).isoformat(),
                    },
                    "status": {"phase": "Error"},
                }
                for cron in ("eatbid-poll-open", "eatbid-mart-reap")
            ],
        ),
        now=_지금,
    )

    급함 = {v.key: v.explanation.urgency for v in 판정 if v.explanation}
    assert 급함 == {
        "cron-workflow:eatbid-poll-open": URGENT_NOW,
        "cron-workflow:eatbid-mart-reap": TODAY,
    }


@pytest.mark.parametrize(
    "objects",
    [
        [],
        [
            BackupObject(
                key="old", last_modified=_지금 - timedelta(hours=5), size_bytes=10
            )
        ],
    ],
    ids=["없음", "늦고_작음"],
)
def test_백업_판정의_모든_갈래가_설명을_든다(objects: list[BackupObject]) -> None:
    _설명이_온전하다(evaluate_backups(lambda _e: objects, now=_지금))


def test_백업_조회_실패도_설명을_든다() -> None:
    def 막힌_목록(_expectation: object) -> list[BackupObject]:
        raise PermissionError("403")

    실패 = evaluate_backups(막힌_목록, now=_지금)
    _설명이_온전하다(실패)
    assert len(실패) == len(BACKUP_EXPECTATIONS)


def test_GitHub_판정의_모든_갈래가_설명을_든다() -> None:
    오래된 = (_지금 - timedelta(hours=3)).isoformat()
    회차들 = [
        {"status": "queued", "created_at": 오래된},
        {
            "status": "completed",
            "conclusion": "failure",
            "created_at": "2026-09-28T00:00:00Z",
        },
    ]

    판정 = evaluate_workflows(lambda _e: 회차들, now=_지금)

    _설명이_온전하다(판정)
    assert len(판정) == 2 * len(GITHUB_EXPECTATIONS)
    for expectation in GITHUB_EXPECTATIONS:
        assert expectation.what.strip() and expectation.impact.strip(), expectation.key


def test_GitHub_조회_실패도_설명을_든다() -> None:
    def 막힌_조회(_expectation: object) -> list[Mapping[str, Any]]:
        raise ConnectionError("rate limit")

    _설명이_온전하다(evaluate_workflows(막힌_조회, now=_지금))
