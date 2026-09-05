"""보유율 판정이 수집 구간의 축을 실제로 읽는지 PostgreSQL에서 확인한다.

지금 수집은 전국 단위 날짜 창으로만 돌기 때문에 시도 축이 없다. 그 사실이 `unknown`으로 나오는
것이 정상이며 여기서 그것을 고정한다(설계 §5, PDR-0003).
"""

from __future__ import annotations

from uuid import UUID, uuid4

from eatbid.mart.build_coverage import fill_build_coverage
from eatbid.source.eat.code_schemes import AUCTION_LOCATION_SIGUNGU

from .conftest import PipelineServices
from .mart_seed import code_value
from .mart_support import (
    MART_AS_OF,
    create_source_release,
    fetch_all,
    mart_plan,
    open_build,
)

DETAIL_DATASET = "ds_info"
LIST_ENDPOINT = "bid-list"
COVERAGE_PARSER_VERSION = "eat-v1"


def _seed_list_window(
    services: PipelineServices,
    source_release_id: UUID,
    *,
    region_code: str,
    start_date: str,
    end_date: str,
) -> None:
    """목록 요청 단위 하나를 그 release의 run에 심는다. 보유율의 축은 이 매개변수가 정한다."""
    run_id = uuid4()
    with services.connection.cursor() as cursor:
        cursor.execute(
            """
            insert into ingest.run
              (run_id, mode, status, build_sha, parser_version, started_at,
               expected_count, captured_count, published_count)
            values (%s, 'backfill', 'planned', %s, %s, %s, 0, 0, 0)
            """,
            (run_id, "c" * 64, COVERAGE_PARSER_VERSION, MART_AS_OF),
        )
        cursor.execute(
            """
            insert into ingest.request_unit
              (run_id, source, endpoint, request_params, request_params_hash,
               expected_count, observed_count, status)
            values (%s, 'eat', %s,
                    jsonb_build_object(
                      'P_BID_BGNG_DT', %s::text, 'P_BID_END_DT', %s::text,
                      'P_PRGRS_STAT_CD', '',
                      'P_CTPV_CD', %s::text, 'START_PAGE', '1', 'PAGE_SIZE', '100'),
                    %s, 1, 1, 'captured')
            """,
            (
                run_id,
                LIST_ENDPOINT,
                start_date,
                end_date,
                region_code,
                uuid4().hex + uuid4().hex,
            ),
        )
        cursor.execute(
            "insert into ingest.source_release_run (source_release_id, run_id) values (%s, %s)",
            (source_release_id, run_id),
        )
    services.connection.commit()


def _seed_detail_corpus(
    services: PipelineServices,
    source_release_id: UUID,
    *,
    expected: int,
    observed: int,
    normalized: int,
    quarantined: int,
) -> None:
    with services.connection.cursor() as cursor:
        cursor.execute(
            """
            insert into ingest.source_release_dataset
              (source_release_id, endpoint, dataset, record_type, parser_version,
               schema_fingerprint, expected_count, observed_count, normalized_count,
               quarantined_count, required)
            values (%s, 'bid-detail', %s, 'auction.v1', %s, %s, %s, %s, %s, %s, true)
            """,
            (
                source_release_id,
                DETAIL_DATASET,
                COVERAGE_PARSER_VERSION,
                "a" * 64,
                expected,
                observed,
                normalized,
                quarantined,
            ),
        )
    services.connection.commit()


def _coverage_rows(services: PipelineServices, build_id: int) -> list[tuple]:
    return fetch_all(
        services,
        """
        select region_code_value_id, month_kst, expected_count, observed_count,
               normalized_count, quarantined_count, coverage
          from mart.build_coverage
         where build_id = %s
         order by month_kst
        """,
        (build_id,),
    )


def _build(services: PipelineServices, source_release_id: UUID) -> int:
    plan = mart_plan(source_release_id, parser_version=COVERAGE_PARSER_VERSION)
    build_id = open_build(services, plan)
    fill_build_coverage(services.connection, plan=plan, build_id=build_id)
    services.connection.commit()
    return build_id


def test_전국_단위로만_수집한_구간의_시도_보유율은_unknown이다(
    pipeline_services: PipelineServices,
) -> None:
    source_release_id = create_source_release(pipeline_services)
    _seed_list_window(
        pipeline_services,
        source_release_id,
        region_code="",
        start_date="20260301",
        end_date="20260331",
    )
    _seed_detail_corpus(
        pipeline_services,
        source_release_id,
        expected=10,
        observed=10,
        normalized=10,
        quarantined=0,
    )

    rows = _coverage_rows(pipeline_services, _build(pipeline_services, source_release_id))

    assert len(rows) == 1
    (row,) = rows
    assert row[0] is None
    assert row[1].isoformat() == "2026-03-01"
    assert (row[2], row[3], row[4], row[5]) == (10, 10, 10, 0)
    # 수는 다 맞지만 그 수를 시도로 나눌 수 없다. 모르는 것을 complete라고 말하지 않는다.
    assert row[6] == "unknown"


def test_지역과_달_축으로_나뉜_수집만_complete를_말한다(
    pipeline_services: PipelineServices,
) -> None:
    region_code_value_id = code_value(
        pipeline_services,
        namespace=AUCTION_LOCATION_SIGUNGU.namespace,
        code="11110",
    )
    source_release_id = create_source_release(pipeline_services)
    _seed_list_window(
        pipeline_services,
        source_release_id,
        region_code="11110",
        start_date="20260401",
        end_date="20260430",
    )
    _seed_detail_corpus(
        pipeline_services,
        source_release_id,
        expected=7,
        observed=7,
        normalized=7,
        quarantined=0,
    )

    rows = _coverage_rows(pipeline_services, _build(pipeline_services, source_release_id))

    assert len(rows) == 1
    (row,) = rows
    assert row[0] == region_code_value_id
    assert row[1].isoformat() == "2026-04-01"
    assert row[6] == "complete"


def test_격리된_회차가_있으면_partial이다(
    pipeline_services: PipelineServices,
) -> None:
    code_value(
        pipeline_services,
        namespace=AUCTION_LOCATION_SIGUNGU.namespace,
        code="11140",
    )
    source_release_id = create_source_release(pipeline_services)
    _seed_list_window(
        pipeline_services,
        source_release_id,
        region_code="11140",
        start_date="20260501",
        end_date="20260531",
    )
    _seed_detail_corpus(
        pipeline_services,
        source_release_id,
        expected=9,
        observed=9,
        normalized=8,
        quarantined=1,
    )

    rows = _coverage_rows(pipeline_services, _build(pipeline_services, source_release_id))

    (row,) = rows
    assert (row[4], row[5]) == (8, 1)
    assert row[6] == "partial"


def test_창이_한_달을_넘으면_달마다_행을_만들되_unknown으로_남긴다(
    pipeline_services: PipelineServices,
) -> None:
    code_value(
        pipeline_services,
        namespace=AUCTION_LOCATION_SIGUNGU.namespace,
        code="11170",
    )
    source_release_id = create_source_release(pipeline_services)
    _seed_list_window(
        pipeline_services,
        source_release_id,
        region_code="11170",
        start_date="20260601",
        end_date="20260731",
    )
    _seed_detail_corpus(
        pipeline_services,
        source_release_id,
        expected=4,
        observed=4,
        normalized=4,
        quarantined=0,
    )

    rows = _coverage_rows(pipeline_services, _build(pipeline_services, source_release_id))

    assert [row[1].isoformat() for row in rows] == ["2026-06-01", "2026-07-01"]
    # 두 달을 덮은 요청 하나의 수를 달마다 나눠 담을 방법이 없다.
    assert {row[6] for row in rows} == {"unknown"}


def test_목록_요청이_없는_release는_보유율_행을_만들지_않는다(
    pipeline_services: PipelineServices,
) -> None:
    """행이 없다는 것이 `none`이다. (지역 × 달) 모집단은 화면의 코호트가 정하지 빌더가 정하지 않는다."""
    source_release_id = create_source_release(pipeline_services)
    _seed_detail_corpus(
        pipeline_services,
        source_release_id,
        expected=0,
        observed=0,
        normalized=0,
        quarantined=0,
    )

    assert _coverage_rows(pipeline_services, _build(pipeline_services, source_release_id)) == []
