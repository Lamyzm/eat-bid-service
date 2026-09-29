"""모듈 책임: 상태 보고의 DB 질의가 실제 스키마(ingest.run·publication_exclusion·backfill_coverage)에서 돌아 크롤러·발행·DB 구획을 채우는지 고정한다."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from datetime import UTC, datetime, timedelta
from typing import Any

from psycopg.rows import dict_row

from eatbid.monitoring.report_schedule import report_slot
from eatbid.monitoring.status_collect import StatusSources, collect_status_report
from eatbid.monitoring.status_facts import CrawlerFacts, PublicationFacts
from eatbid.monitoring.status_report import format_status_report

from .conftest import MigratedDatabase


def test_실제_스키마에서_상태_보고의_DB_구획이_확인_못_함_없이_채워진다(
    migrated_db: MigratedDatabase,
) -> None:
    """단위 검사는 SQL 문자열을 그대로 믿는다. 열 이름·interval 평균·view 이름이 틀리면 여기서만 드러나고, 틀린 채
    배포되면 보고의 크롤러 구획이 매일 "확인 못 함"으로 조용히 비어 있게 된다."""
    지금 = datetime(2026, 9, 29, 11, 18, tzinfo=UTC)
    자리 = report_slot(지금)
    assert 자리 is not None

    with migrated_db.connect() as connection:

        def run_query(
            sql: str, parameters: Mapping[str, Any]
        ) -> Sequence[Mapping[str, Any]]:
            with connection.cursor(row_factory=dict_row) as cursor:
                cursor.execute(sql, parameters)
                return list(cursor.fetchall())

        보고 = collect_status_report(
            environment="test",
            slot=자리,
            now=지금,
            run_query=run_query,
            sources=StatusSources(),
            problems=(),
        )
        with connection.cursor(row_factory=dict_row) as cursor:
            # migrated_db는 여러 통합 검사가 나눠 쓴다. 앞선 검사가 남긴 run이 있을 수 있으므로 같은 조건을 직접 센다.
            cursor.execute(
                "select count(*) as n from ingest.run where mode = 'poll-open'"
                " and started_at >= %(start)s and started_at < %(end)s",
                {"start": 자리.start, "end": 자리.end},
            )
            started = cursor.fetchone()["n"]  # type: ignore[index]

    assert isinstance(보고.crawler, CrawlerFacts), 보고.crawler
    assert 보고.crawler.planned == 72
    assert 보고.crawler.started == started
    assert isinstance(보고.publication, PublicationFacts), 보고.publication
    assert isinstance(보고.database.size_bytes, int) and 보고.database.size_bytes > 0
    assert len(format_status_report(보고)) <= 4096
    assert 지금 - timedelta(days=1) < 자리.end <= 지금
