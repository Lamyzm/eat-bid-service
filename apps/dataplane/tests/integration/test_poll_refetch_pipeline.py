from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from uuid import UUID

from eatbid.composition import Application
from eatbid.ingest.postgres_release_repository import PsycopgSourceReleaseRepository
from eatbid.mart.models import DEFAULT_REGION_SCHEME
from eatbid.mart.open_auction_snapshot import open_auction_snapshot_filler
from eatbid.mart.org_round_summary import fill_org_round_summary
from eatbid.mart.postgres_repository import PsycopgMartBuildRepository
from eatbid.mart.win_rate_distribution import fill_win_rate_distribution
from eatbid.pipeline.discover import DiscoveryPlan, DiscoveryResult, discover_release
from eatbid.pipeline.discovery_persistence import RawFirstDiscoveryPersistence
from eatbid.pipeline.refetch_baseline import PsycopgRefetchBaselineReader
from eatbid.source.client import SourceResponse

from ..unit.fakes import StaticSourceClient
from .conftest import MigratedDatabase, PipelineServices
from .mart_support import MART_AS_OF

LIST_FIXTURE = Path(__file__).parents[1] / "fixtures" / "eat" / "bid-list-one.xml"
DETAIL_FIXTURE = Path(__file__).parents[1] / "fixtures" / "eat" / "bid-detail-one.xml"
BUILD_SHA = "a" * 64
T0 = datetime(2026, 9, 7, 0, 0, tzinfo=UTC)
POLL = timedelta(minutes=30)


def _정체성(round_number: int) -> dict[str, UUID]:
    prefix = f"76{round_number:02d}0000-0000-0000-0000-00000000000"
    return {
        "run_id": UUID(f"{prefix}1"),
        "source_release_id": UUID(f"{prefix}2"),
        "detail_run_id": UUID(f"{prefix}3"),
        "publication_id": UUID(f"{prefix}4"),
    }


def _발견(
    services: PipelineServices,
    *,
    round_number: int,
    mode: str,
    list_body: bytes,
    as_of: datetime,
) -> DiscoveryResult:
    identity = _정체성(round_number)
    persistence = RawFirstDiscoveryPersistence(
        ingest_repository=services.repository,
        release_repository=PsycopgSourceReleaseRepository(services.connection),
        raw_store=services.store,
        baseline_reader=PsycopgRefetchBaselineReader(services.connection, services.store),
    )
    return discover_release(
        DiscoveryPlan(
            source_release_id=identity["source_release_id"],
            run_id=identity["run_id"],
            detail_run_id=identity["detail_run_id"],
            mode=mode,  # type: ignore[arg-type]
            release_name=f"EAT-76 회차 {round_number}",
            as_of=as_of,
            build_sha=BUILD_SHA,
            parser_version="eat-v1",
            started_at=as_of,
            completed_at=as_of,
            start_date="20260907",
            end_date="20260907",
            progress_status_code="",
            region_code="",
            page_size=100,
            page_budget=1,
        ),
        persistence,
        StaticSourceClient(SourceResponse(200, list_body, as_of)),
    )


def _애플리케이션(
    services: PipelineServices, *, fetched_at: datetime, mart_repository: object = None
) -> Application:
    return Application(
        connection=services.connection,
        http_client=StaticSourceClient(
            SourceResponse(200, DETAIL_FIXTURE.read_bytes(), fetched_at)
        ),
        raw_store=services.store,
        ingest_repository=services.repository,
        release_repository=PsycopgSourceReleaseRepository(services.connection),
        normalization_repository=services.normalization_repository,
        publication_repository=services.publication_repository,
        replay_repository=services.replay_repository,
        projection_repository=services.projection_repository,
        mart_repository=mart_repository,
    )


def _build_marts_인자(round_number: int, *, built_at: datetime) -> SimpleNamespace:
    identity = _정체성(round_number)
    return SimpleNamespace(
        source_release_id=identity["source_release_id"],
        run_id=identity["detail_run_id"],
        publication_id=identity["publication_id"],
        mart=None,
        calc_version="mart-eat-98",
        build_sha=BUILD_SHA,
        parser_version="eat-v1",
        region_scheme=DEFAULT_REGION_SCHEME,
        as_of=built_at,
        built_at=built_at,
    )


def _스냅샷_build_수(services: PipelineServices, publication_id: UUID) -> int:
    with services.connection.cursor() as cursor:
        cursor.execute(
            "select count(*) from mart.build "
            "where mart_name = 'open_auction_snapshot' and publication_id = %s",
            (publication_id,),
        )
        row = cursor.fetchone()
    services.connection.commit()
    assert row is not None
    return int(row[0])


def _mart_repository(
    services: PipelineServices, migrated_db: MigratedDatabase
) -> PsycopgMartBuildRepository:
    return PsycopgMartBuildRepository(
        services.connection,
        migrated_db.connect,
        {
            "org_round_summary": fill_org_round_summary,
            "win_rate_distribution_monthly": fill_win_rate_distribution,
            "open_auction_snapshot": open_auction_snapshot_filler(services.store),
        },
    )


def _상세까지_발행한다(
    services: PipelineServices, result: DiscoveryResult, *, round_number: int, at: datetime
) -> None:
    identity = _정체성(round_number)
    application = _애플리케이션(services, fetched_at=at)
    for external_bid_id in result.detail_external_bid_ids:
        observation = application.capture(
            SimpleNamespace(
                source_release_id=identity["source_release_id"],
                run_id=identity["detail_run_id"],
                external_bid_id=external_bid_id,
            )
        )
        application.normalize(
            SimpleNamespace(
                source_release_id=identity["source_release_id"],
                run_id=identity["detail_run_id"],
                observation_id=observation.observation_id,
                parser_version="eat-v1",
                normalized_at=at,
            )
        )
    publication = application.validate(
        SimpleNamespace(
            source_release_id=identity["source_release_id"],
            run_id=identity["detail_run_id"],
            publication_id=identity["publication_id"],
            validated_at=at,
        )
    )
    assert publication.status == "validated"
    application.project(
        SimpleNamespace(
            source_release_id=identity["source_release_id"],
            run_id=identity["detail_run_id"],
            publication_id=identity["publication_id"],
            build_sha=BUILD_SHA,
            activated_at=at,
        )
    )


def _release_상태(services: PipelineServices, source_release_id: UUID) -> tuple[object, ...]:
    with services.connection.cursor() as cursor:
        cursor.execute(
            """
            select release.status, dataset.expected_count, dataset.observed_count
              from ingest.source_release as release
              join ingest.source_release_dataset as dataset
                on dataset.source_release_id = release.source_release_id
             where release.source_release_id = %s and dataset.endpoint = 'bid-detail'
            """,
            (source_release_id,),
        )
        row = cursor.fetchone()
    services.connection.commit()
    assert row is not None
    return row


def test_poll_open은_봉인된_직전_release를_기준으로_바뀐_공고만_다시_부르고_빈_회차도_발행한다(
    pipeline_services: PipelineServices,
) -> None:
    unchanged = LIST_FIXTURE.read_bytes()
    changed = unchanged.replace(
        b'<Col id="BID_CNT">0</Col>', b'<Col id="BID_CNT">1</Col>', 1
    )
    assert changed != unchanged

    # 회차 1: 기준이 될 daily-reconcile. 목록 전부의 상세를 부르고 봉인까지 간다.
    first = _발견(
        pipeline_services, round_number=1, mode="daily-reconcile", list_body=unchanged, as_of=T0
    )
    assert first.refetch_reason_counts == {"full-mode": 1, "unchanged": 0}
    _상세까지_발행한다(pipeline_services, first, round_number=1, at=T0)
    assert _release_상태(pipeline_services, first.source_release_id) == ("sealed", 1, 1)

    # 회차 2: 신호가 그대로인 poll-open. 상세 request unit이 0건이어도 봉인·검증·발행이 닫힌다.
    second = _발견(
        pipeline_services, round_number=2, mode="poll-open", list_body=unchanged, as_of=T0 + POLL
    )
    assert second.baseline_source_release_id == first.source_release_id
    assert second.detail_external_bid_ids == ()
    assert second.external_bid_id_chunks == ()
    assert second.refetch_reason_counts == {"unchanged": 1}
    _상세까지_발행한다(pipeline_services, second, round_number=2, at=T0 + POLL)
    assert _release_상태(pipeline_services, second.source_release_id) == ("sealed", 0, 0)

    # 회차 3: BID_CNT가 오른 poll-open. 기준은 가장 최근에 봉인된 회차 2다.
    third = _발견(
        pipeline_services,
        round_number=3,
        mode="poll-open",
        list_body=changed,
        as_of=T0 + 2 * POLL,
    )
    assert third.baseline_source_release_id == second.source_release_id
    assert third.detail_external_bid_ids == ("5610615",)
    assert third.refetch_reason_counts == {"signal-changed": 1, "unchanged": 0}
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            "select expected_count from ingest.run where run_id = %s",
            (_정체성(3)["detail_run_id"],),
        )
        detail_run = cursor.fetchone()
    pipeline_services.connection.commit()
    assert detail_run == (1,)


def test_poll_open_발행의_build_marts가_열린_공고_스냅샷_활성_build를_만든다(
    pipeline_services: PipelineServices, migrated_db: MigratedDatabase
) -> None:
    unchanged = LIST_FIXTURE.read_bytes()
    changed = unchanged.replace(
        b'<Col id="BID_CNT">0</Col>', b'<Col id="BID_CNT">2</Col>', 1
    )
    baseline_at = T0 + 10 * POLL
    polled_at = baseline_at + POLL

    # 회차 4: poll-open의 기준이 될 daily-reconcile. 회차 5: 신호가 바뀐 poll-open 발행.
    baseline = _발견(
        pipeline_services,
        round_number=4,
        mode="daily-reconcile",
        list_body=unchanged,
        as_of=baseline_at,
    )
    _상세까지_발행한다(pipeline_services, baseline, round_number=4, at=baseline_at)
    polled = _발견(
        pipeline_services, round_number=5, mode="poll-open", list_body=changed, as_of=polled_at
    )
    assert polled.detail_external_bid_ids == ("5610615",)
    _상세까지_발행한다(pipeline_services, polled, round_number=5, at=polled_at)
    identity = _정체성(5)
    # 활성 전환은 공유 DB의 현재 활성 build를 물리므로 빌드 시각이 그 build의 활성 시각보다 뒤여야
    # `mart_build_supersession_chronology`를 지난다. 다른 mart test의 고정 시계(MART_AS_OF)보다 뒤에 둔다.
    assert polled_at > MART_AS_OF
    built_at = polled_at

    results = _애플리케이션(
        pipeline_services,
        fetched_at=polled_at,
        mart_repository=_mart_repository(pipeline_services, migrated_db),
    ).build_marts(_build_marts_인자(5, built_at=built_at))

    # --mart 없이 발행의 record type(eat-v1 → auction.v1, 명단 없음)으로 골랐는데도 스냅샷이
    # 따라온다. 분포는 v1 발행의 영향 범위가 아니라 빠진다.
    assert {result.mart_name for result in results} == {
        "org_round_summary",
        "open_auction_snapshot",
    }
    snapshot = next(r for r in results if r.mart_name == "open_auction_snapshot")
    assert snapshot.status == "active"
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            """
            select count(*)
              from mart.open_auction_snapshot as snapshot
              join mart.build as build on build.build_id = snapshot.build_id
             where build.mart_name = 'open_auction_snapshot' and build.status = 'active'
               and build.publication_id = %s
            """,
            (identity["publication_id"],),
        )
        active_rows = cursor.fetchone()
    pipeline_services.connection.commit()
    assert active_rows is not None and active_rows[0] == snapshot.row_count > 0


def test_backfill_발행의_build_marts는_열린_공고_스냅샷_build를_만들지_않는다(
    pipeline_services: PipelineServices, migrated_db: MigratedDatabase
) -> None:
    backfilled_at = T0 + 20 * POLL
    # 회차 6: 과거 창을 읽는 backfill. 같은 목록 fixture라도 스냅샷은 열린 공고의 관측이 아니다.
    backfill = _발견(
        pipeline_services,
        round_number=6,
        mode="backfill",
        list_body=LIST_FIXTURE.read_bytes(),
        as_of=backfilled_at,
    )
    assert backfill.detail_external_bid_ids == ("5610615",)
    _상세까지_발행한다(pipeline_services, backfill, round_number=6, at=backfilled_at)
    identity = _정체성(6)

    results = _애플리케이션(
        pipeline_services,
        fetched_at=backfilled_at,
        mart_repository=_mart_repository(pipeline_services, migrated_db),
    ).build_marts(_build_marts_인자(6, built_at=backfilled_at))

    # core mart는 그대로 만들되 스냅샷 build 행 자체가 생기지 않는다 — 마감된 과거 공고로 활성
    # 스냅샷을 물리면 오늘 화면이 빈다.
    assert {result.mart_name for result in results} == {"org_round_summary"}
    assert _스냅샷_build_수(pipeline_services, identity["publication_id"]) == 0
