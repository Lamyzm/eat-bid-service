"""모듈 책임: 상태 보고의 사실 수집이 DB 행·Kubernetes 객체를 맞게 옮기고, 원천 하나가 막혀도 나머지 구획을 채우는지 고정한다."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

from eatbid.monitoring.cluster import APPLICATIONS_PATH
from eatbid.monitoring.expectations import EXPECTATIONS
from eatbid.monitoring.report_schedule import report_slot
from eatbid.monitoring.status_cluster import (
    DEPLOYMENTS_PATH,
    PODS_PATH,
    PVC_PATH,
    parse_quantity,
    short_image,
)
from eatbid.monitoring.status_collect import (
    BACKFILL_SQL,
    CRAWLER_RUNS_SQL,
    DATABASE_SIZE_SQL,
    EXCLUDED_SQL,
    LAST_SUCCESS_SQL,
    RECONCILE_SQL,
    StatusSources,
    collect_status_report,
)
from eatbid.monitoring.status_facts import (
    CrawlerFacts,
    DatabaseFacts,
    PublicationFacts,
    Unavailable,
)

_지금 = datetime(2026, 9, 29, 11, 18, tzinfo=UTC)  # 20:18 KST
_자리 = report_slot(_지금)
assert _자리 is not None
_멈춘_발행 = next(e for e in EXPECTATIONS if e.key == "stale-validated-publication")

_행: dict[str, Sequence[Mapping[str, Any]]] = {
    CRAWLER_RUNS_SQL: [
        {
            "started": 70,
            "succeeded": 68,
            "failed": 1,
            "running": 1,
            "published": 1204,
            "average_duration": timedelta(minutes=7),
            "longest_duration": timedelta(minutes=36),
        }
    ],
    LAST_SUCCESS_SQL: [{"last_success_at": _지금 - timedelta(minutes=21)}],
    RECONCILE_SQL: [
        {
            "status": "published",
            "started_at": _지금 - timedelta(hours=13),
            "ended_at": _지금 - timedelta(hours=12, minutes=40),
            "published_count": 512,
        }
    ],
    EXCLUDED_SQL: [{"excluded": 3}],
    BACKFILL_SQL: [
        {"complete": 58, "total": 60, "unresolved": 2, "unresolved_windows": 1}
    ],
    _멈춘_발행.sql: [{"publication_id": "p1"}],
    DATABASE_SIZE_SQL: [{"size_bytes": 5 * 1024**3}],
}


def _질의(sql: str, _parameters: Mapping[str, Any]) -> Sequence[Mapping[str, Any]]:
    return _행[sql]


_클러스터: dict[str, Sequence[Mapping[str, Any]]] = {
    DEPLOYMENTS_PATH: [
        {
            "metadata": {"name": "server"},
            "spec": {"replicas": 1},
            "status": {"readyReplicas": 1},
        },
        {"metadata": {"name": "web"}, "spec": {"replicas": 1}, "status": {}},
    ],
    PODS_PATH: [
        {
            "metadata": {"name": "server-abc", "labels": {"app": "server"}},
            "status": {
                "containerStatuses": [
                    {
                        "restartCount": 2,
                        "lastState": {
                            "terminated": {"finishedAt": "2026-09-29T04:00:00Z"}
                        },
                    }
                ]
            },
        },
        {
            "metadata": {"name": "postgres-x", "labels": {"app": "postgres"}},
            "status": {},
        },
    ],
    PVC_PATH: [
        {"metadata": {"name": "pgdata"}, "status": {"capacity": {"storage": "20Gi"}}}
    ],
    APPLICATIONS_PATH: [
        {
            "metadata": {"name": "eatbid-prod"},
            "status": {
                "sync": {"status": "Synced", "revision": "3f9c2a1d0b7e"},
                "health": {"status": "Healthy"},
                "summary": {
                    "images": [
                        "ghcr.io/lamyzm/eatbid-server@sha256:0c6c0292fd12371c1f7d23cff6d9de8f",
                        "docker.io/library/postgres:16",
                    ]
                },
            },
        }
    ],
}


def _목록(path: str) -> Sequence[Mapping[str, Any]]:
    return _클러스터[path]


def test_DB와_클러스터와_백업에서_구획마다_사실을_모은다() -> None:
    보고 = collect_status_report(
        environment="prod",
        slot=_자리,
        now=_지금,
        run_query=_질의,
        sources=StatusSources(
            list_resources=_목록,
            probe_http=lambda url: 200 if "server" in url else 503,
            newest_backup=lambda: _지금 - timedelta(minutes=13),
        ),
        problems=(),
    )

    assert isinstance(보고.crawler, CrawlerFacts)
    assert (보고.crawler.planned, 보고.crawler.started, 보고.crawler.skipped) == (
        72,
        70,
        2,
    )
    assert (보고.crawler.published, 보고.crawler.excluded) == (1204, 3)
    assert (
        보고.crawler.reconcile is not None and 보고.crawler.reconcile.published == 512
    )
    assert 보고.publication == PublicationFacts(1, 58, 60, 2, 1)
    assert 보고.database == DatabaseFacts(
        size_bytes=5 * 1024**3,
        volume_bytes=20 * 1024**3,
        last_backup_at=_지금 - timedelta(minutes=13),
    )
    assert not isinstance(보고.backend, Unavailable)
    server, web = 보고.backend
    assert (server.ready, server.desired, server.restarts, server.http_status) == (
        1,
        1,
        2,
        200,
    )
    assert server.last_restart_at == datetime(2026, 9, 29, 4, 0, tzinfo=UTC)
    assert (web.ready, web.desired, web.restarts, web.http_status) == (0, 1, 0, 503)
    assert not isinstance(보고.deploy, Unavailable)
    assert 보고.deploy[0].images == ("eatbid-server@sha256:0c6c0292fd12",)
    assert 보고.deploy[0].revision == "3f9c2a1d0b7e"


def test_클러스터_읽기가_막혀도_DB_구획은_채우고_막힌_구획만_확인_못_함이다() -> None:
    def 막힌_목록(path: str) -> Sequence[Mapping[str, Any]]:
        raise PermissionError(f"403 {path}")

    def 끊긴_HTTP(url: str) -> int:
        raise ConnectionError(url)

    보고 = collect_status_report(
        environment="prod",
        slot=_자리,
        now=_지금,
        run_query=_질의,
        sources=StatusSources(list_resources=막힌_목록, probe_http=끊긴_HTTP),
        problems=(),
    )

    assert isinstance(보고.crawler, CrawlerFacts)
    assert isinstance(보고.publication, PublicationFacts)
    assert (
        isinstance(보고.backend, Unavailable)
        and "PermissionError" in 보고.backend.reason
    )
    assert isinstance(보고.deploy, Unavailable)
    assert 보고.database.size_bytes == 5 * 1024**3
    assert isinstance(보고.database.volume_bytes, Unavailable)
    assert 보고.database.last_backup_at == Unavailable("백업 조회 수단 없음")


def test_DB_질의가_깨지면_크롤러와_발행은_확인_못_함이다() -> None:
    def 깨진_질의(
        _sql: str, _parameters: Mapping[str, Any]
    ) -> Sequence[Mapping[str, Any]]:
        raise RuntimeError("connection lost")

    보고 = collect_status_report(
        environment="prod",
        slot=_자리,
        now=_지금,
        run_query=깨진_질의,
        sources=StatusSources(),
        problems=(),
    )

    assert 보고.crawler == Unavailable("RuntimeError: connection lost")
    assert 보고.publication == Unavailable("RuntimeError: connection lost")
    assert 보고.database.size_bytes == Unavailable("RuntimeError: connection lost")


@pytest.mark.parametrize(
    ("text", "size"),
    [
        ("2Gi", 2 * 1024**3),
        ("500Mi", 500 * 1024**2),
        ("10G", 10 * 1000**3),
        ("1024", 1024),
    ],
)
def test_PVC_용량_표기를_바이트로_읽는다(text: str, size: int) -> None:
    assert parse_quantity(text) == size


def test_읽을_수_없는_용량_표기는_어림하지_않고_실패한다() -> None:
    with pytest.raises(ValueError):
        parse_quantity("1.5Gi")


def test_이미지는_이름과_digest_앞_12자리로_줄인다() -> None:
    assert (
        short_image("ghcr.io/lamyzm/eatbid-web@sha256:d8a04107853da577ac1275a0f771797c")
        == "eatbid-web@sha256:d8a04107853d"
    )
    assert short_image("ghcr.io/lamyzm/eatbid-web:dev") == "eatbid-web:dev"
