from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

import pytest

from eatbid.cli import main
from eatbid.composition import Application
from eatbid.config import ApplicationSettings
from eatbid.errors import SourceUnavailableError
from eatbid.ingest.models import CaptureRequest
from eatbid.ingest.postgres_release_repository import PsycopgSourceReleaseRepository
from eatbid.source.client import SourceResponse

from .conftest import PipelineServices

FIXTURES = Path(__file__).parents[1] / "fixtures" / "eat"
NOW = datetime(2026, 9, 1, 4, 0, tzinfo=UTC)
SHA = "a" * 64
BID_IDS = ("5610615", "5610616", "5610617")


class _빌린애플리케이션:
    def __init__(self, application: Application) -> None:
        self._application = application

    def __enter__(self) -> Application:
        return self._application

    def __exit__(self, *args: object) -> None:
        return None


class _아이디별소스:
    """공고 ID마다 다른 상세 본문을 주고, 지정한 ID에서는 응답 없이 전송 실패로 끝난다."""

    def __init__(self, *, list_body: bytes, unreachable: frozenset[str]) -> None:
        self.list_body = list_body
        self.unreachable = unreachable
        self.detail_calls: list[str] = []

    def fetch(self, request: CaptureRequest) -> SourceResponse:
        external_bid_id = request.params.get("ELCTRN_BID_ID")
        if external_bid_id is None:
            return SourceResponse(200, self.list_body, NOW)
        self.detail_calls.append(external_bid_id)
        if external_bid_id in self.unreachable:
            raise SourceUnavailableError(
                f"eaT request failed [endpoint=bid-detail id={external_bid_id}]",
                attempts=3,
            )
        return SourceResponse(200, _detail_body(external_bid_id), NOW)


def _list_body() -> bytes:
    """한 행짜리 목록 fixture를 세 행으로 늘린다. 세 건이 한 chunk에 담기는지가 이 검사의 주제다."""
    text = (FIXTURES / "bid-list-one.xml").read_text(encoding="utf-8")
    start = text.index("      <Row>")
    end = text.index("</Row>", start) + len("</Row>\n")
    row = text[start:end]
    rows = "".join(
        row.replace("<Col id=\"TOT_CNT\">1</Col>", f"<Col id=\"TOT_CNT\">{len(BID_IDS)}</Col>")
        .replace("<Col id=\"ETN_BID_ID\">5610615</Col>", f"<Col id=\"ETN_BID_ID\">{bid_id}</Col>")
        for bid_id in BID_IDS
    )
    return (text[:start] + rows + text[end:]).encode("utf-8")


def _detail_body(external_bid_id: str) -> bytes:
    """공고마다 다른 본문을 준다. 같은 본문이면 R2가 content hash로 하나로 앉혀 건별 원본 주소가
    따로 남는지를 확인할 수 없다."""
    text = (FIXTURES / "bid-detail-one.xml").read_text(encoding="utf-8")
    return text.replace("E250617-472599-1", f"E250617-{external_bid_id}-1").encode("utf-8")


def _설정() -> ApplicationSettings:
    """왜: 건별 실패 한 줄은 비밀값 제거 규칙을 거쳐 나간다. 그 경로를 실제로 지나도록 CLI 경계와
    같은 모양의 설정을 준다."""
    return ApplicationSettings(
        DATABASE_URL="postgresql://user:db-password@localhost:5432/eatbid",
        R2_ENDPOINT_URL="https://account.r2.cloudflarestorage.com",
        R2_BUCKET="eatbid-raw",
        R2_ACCESS_KEY_ID="access-secret",
        R2_SECRET_ACCESS_KEY="r2-secret",
    )


def _공통(command: str, run_id: object, release_id: object) -> list[str]:
    return [
        command,
        "--run-id", str(run_id),
        "--source-release-id", str(release_id),
        "--build-sha", SHA,
        "--parser-version", "eat-v1",
    ]


def _발견한다(
    services: PipelineServices,
    source: _아이디별소스,
    capsys: pytest.CaptureFixture[str],
) -> tuple[object, object, Any, Any]:
    release_id, discovery_run_id, detail_run_id = uuid4(), uuid4(), uuid4()
    application = Application(
        connection=services.connection,
        http_client=source,
        raw_store=services.store,
        ingest_repository=services.repository,
        release_repository=PsycopgSourceReleaseRepository(services.connection),
        normalization_repository=services.normalization_repository,
        publication_repository=services.publication_repository,
        replay_repository=services.replay_repository,
        projection_repository=services.projection_repository,
    )
    factory = lambda _: _빌린애플리케이션(application)
    settings: Any = _설정()
    discover = _공통("discover", discovery_run_id, release_id) + [
        "--detail-run-id", str(detail_run_id),
        "--mode", "backfill",
        "--release-name", f"chunk 종단 검사 {release_id}",
        "--as-of", NOW.isoformat(),
        "--started-at", NOW.isoformat(),
        "--completed-at", NOW.isoformat(),
        "--start-date", "20260901",
        "--end-date", "20260901",
        "--page-size", "100",
    ]
    assert main(discover, application_factory=factory, settings=settings) == 0
    discovered = json.loads(capsys.readouterr().out)
    assert discovered["external_bid_id_chunks"] == [list(BID_IDS)]
    return release_id, detail_run_id, factory, settings


def test_chunk_하나가_건마다_request_unit과_raw_관측을_따로_남긴다(
    pipeline_services: PipelineServices, capsys: pytest.CaptureFixture[str]
) -> None:
    services = pipeline_services
    source = _아이디별소스(list_body=_list_body(), unreachable=frozenset())
    release_id, detail_run_id, factory, settings = _발견한다(services, source, capsys)

    capture = _공통("capture", detail_run_id, release_id) + [
        "--external-bid-ids-json", json.dumps(list(BID_IDS)),
        "--started-at", NOW.isoformat(),
    ]
    assert main(capture, application_factory=factory, settings=settings) == 0

    captured = json.loads(capsys.readouterr().out)
    assert source.detail_calls == list(BID_IDS)
    assert len(captured["observation_ids"]) == len(BID_IDS)
    with services.connection.cursor() as cursor:
        cursor.execute(
            """
            select o.request_params->>'ELCTRN_BID_ID', o.request_unit_id,
                   o.content_sha256
            from ingest.raw_observation o
            where o.run_id = %s
            order by o.observation_id
            """,
            (detail_run_id,),
        )
        observations = cursor.fetchall()
        cursor.execute(
            "select count(*) from ingest.request_unit where run_id = %s",
            (detail_run_id,),
        )
        request_units = cursor.fetchone()

    # 한 pod가 세 건을 관측했지만 request unit·관측·원본 주소는 여전히 건마다 하나씩이다.
    assert [row[0] for row in observations] == list(BID_IDS)
    assert len({row[1] for row in observations}) == len(BID_IDS)
    assert len({row[2] for row in observations}) == len(BID_IDS)
    assert request_units == (len(BID_IDS),)


def test_chunk_안_한_건의_전송_실패는_나머지를_관측하고_fail_closed로_끝난다(
    pipeline_services: PipelineServices, capsys: pytest.CaptureFixture[str]
) -> None:
    services = pipeline_services
    source = _아이디별소스(list_body=_list_body(), unreachable=frozenset({BID_IDS[1]}))
    release_id, detail_run_id, factory, settings = _발견한다(services, source, capsys)

    capture = _공통("capture", detail_run_id, release_id) + [
        "--external-bid-ids-json", json.dumps(list(BID_IDS)),
        "--started-at", NOW.isoformat(),
    ]
    assert main(capture, application_factory=factory, settings=settings) == 69

    captured = capsys.readouterr()
    payload = json.loads(captured.out)
    assert source.detail_calls == list(BID_IDS)
    assert payload["failed_count"] == 1
    assert payload["skipped"] == []
    assert len(payload["observation_ids"]) == len(BID_IDS) - 1
    assert [item["failure_category"] for item in payload["results"]] == [
        None,
        "TRANSIENT_NETWORK",
        None,
    ]
    assert json.loads(captured.err.strip())["chunk_item"] == BID_IDS[1]

    with services.connection.cursor() as cursor:
        cursor.execute(
            """
            select o.request_params->>'ELCTRN_BID_ID'
            from ingest.raw_observation o
            where o.run_id = %s
            order by o.observation_id
            """,
            (detail_run_id,),
        )
        observed = [row[0] for row in cursor.fetchall()]
        cursor.execute(
            """
            select request_params->>'ELCTRN_BID_ID', observed_count, status
            from ingest.request_unit
            where run_id = %s
            order by request_params->>'ELCTRN_BID_ID'
            """,
            (detail_run_id,),
        )
        units = cursor.fetchall()

    # 응답이 오지 않은 건은 관측도 남기지 않는다. 남은 두 건은 그대로 보존되고 실패는 exit code로만
    # 드러나 DAG가 뒤 단계를 잇지 못한다.
    assert observed == [BID_IDS[0], BID_IDS[2]]
    assert units == [
        (BID_IDS[0], 1, "captured"),
        (BID_IDS[1], 0, "planned"),
        (BID_IDS[2], 1, "captured"),
    ]
