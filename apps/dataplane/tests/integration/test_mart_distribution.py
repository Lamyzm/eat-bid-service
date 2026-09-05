"""월별 낙찰 사정률 분포 빌드의 코호트·구간·달 경계 정의를 실제 PostgreSQL에서 고정한다."""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal

from eatbid.mart.win_rate_distribution import fill_win_rate_distribution

from .conftest import PipelineServices
from .mart_seed import code_value, seed_evidence, seed_organization, seed_round
from .mart_support import build_mart, create_source_release, fetch_all, mart_plan

DISTRIBUTION = "win_rate_distribution_monthly"


def _rows(services: PipelineServices, build_id: int, organization_id: int) -> list[tuple]:
    """이 test가 심은 기관의 행만 읽는다. DB는 session 하나를 공유한다."""
    return fetch_all(
        services,
        """
        select scope, region_code_value_id, organization_id, floor_rate,
               award_method_code_value_id, month_kst, bin_lower, bin_width, attempt_count
          from mart.win_rate_distribution_monthly
         where build_id = %s and organization_id = %s
         order by month_kst, bin_lower
        """,
        (build_id, organization_id),
    )


def _build(services: PipelineServices):
    plan = mart_plan(create_source_release(services), mart_name=DISTRIBUTION)
    return build_mart(services, plan, fill_win_rate_distribution)


def test_칸_경계는_반개구간이라_같은_칸과_다음_칸이_갈린다(
    pipeline_services: PipelineServices,
) -> None:
    evidence = seed_evidence(pipeline_services)
    organization_id = seed_organization(pipeline_services, "반개구간 학교")
    award_method = code_value(
        pipeline_services, namespace="eat:award-method", code="003"
    )
    opened_at = datetime(2026, 3, 10, 2, 0, tzinfo=UTC)
    for rate in ("90.010", "90.019", "90.020"):
        seed_round(
            pipeline_services,
            evidence,
            organization_id=organization_id,
            opened_at=opened_at,
            awarded_rate=Decimal(rate),
            award_method_code_value_id=award_method,
        )

    build_id, _ = _build(pipeline_services)

    rows = _rows(pipeline_services, build_id, organization_id)
    assert [(row[6], row[8]) for row in rows] == [
        (Decimal("90.010"), 2),
        (Decimal("90.020"), 1),
    ]
    assert rows[0][7] == Decimal("0.010")


def test_달_경계는_개찰_시각의_KST_달이다(
    pipeline_services: PipelineServices,
) -> None:
    evidence = seed_evidence(pipeline_services)
    organization_id = seed_organization(pipeline_services, "달 경계 학교")
    award_method = code_value(
        pipeline_services, namespace="eat:award-method", code="003"
    )
    # UTC 2025-12-31T15:00Z는 KST 2026-01-01T00:00이므로 2026-01 행에 든다.
    seed_round(
        pipeline_services,
        evidence,
        organization_id=organization_id,
        opened_at=datetime(2025, 12, 31, 15, 0, tzinfo=UTC),
        awarded_rate=Decimal("90.010"),
        award_method_code_value_id=award_method,
    )
    seed_round(
        pipeline_services,
        evidence,
        organization_id=organization_id,
        opened_at=datetime(2025, 12, 31, 14, 59, tzinfo=UTC),
        awarded_rate=Decimal("90.010"),
        award_method_code_value_id=award_method,
    )

    build_id, _ = _build(pipeline_services)

    rows = _rows(pipeline_services, build_id, organization_id)
    assert [row[5].isoformat() for row in rows] == ["2025-12-01", "2026-01-01"]


def test_네_모집단이_같은_회차를_각각_한_번씩_센다(
    pipeline_services: PipelineServices,
) -> None:
    evidence = seed_evidence(pipeline_services)
    organization_id = seed_organization(pipeline_services, "모집단 학교")
    award_method = code_value(
        pipeline_services, namespace="eat:award-method", code="003"
    )
    sido = code_value(
        pipeline_services, namespace="eat:auction-location-sido", code="48"
    )
    sigungu = code_value(
        pipeline_services, namespace="eat:auction-location-sigungu", code="48121"
    )
    attempt_id = seed_round(
        pipeline_services,
        evidence,
        organization_id=organization_id,
        opened_at=datetime(2026, 4, 10, 2, 0, tzinfo=UTC),
        awarded_rate=Decimal("90.030"),
        award_method_code_value_id=award_method,
        sido_code_value_id=sido,
        sigungu_code_value_id=sigungu,
    )
    assert attempt_id > 0

    build_id, _ = _build(pipeline_services)

    scopes = fetch_all(
        pipeline_services,
        """
        select scope, attempt_count
          from mart.win_rate_distribution_monthly
         where build_id = %s and month_kst = '2026-04-01'
           and (organization_id = %s or region_code_value_id in (%s, %s)
                or (scope = 'national' and bin_lower = 90.030))
         order by scope
        """,
        (build_id, organization_id, sido, sigungu),
    )
    assert [row[0] for row in scopes] == [
        "district",
        "national",
        "organization",
        "province",
    ]
    assert all(row[1] >= 1 for row in scopes)


def test_하한율과_낙찰_방식이_다르면_한_분포에_섞이지_않는다(
    pipeline_services: PipelineServices,
) -> None:
    evidence = seed_evidence(pipeline_services)
    organization_id = seed_organization(pipeline_services, "코호트 학교")
    standard = code_value(pipeline_services, namespace="eat:award-method", code="003")
    unit_price = code_value(pipeline_services, namespace="eat:award-method", code="013")
    opened_at = datetime(2026, 5, 10, 2, 0, tzinfo=UTC)
    seed_round(
        pipeline_services,
        evidence,
        organization_id=organization_id,
        opened_at=opened_at,
        awarded_rate=Decimal("90.010"),
        award_method_code_value_id=standard,
    )
    seed_round(
        pipeline_services,
        evidence,
        organization_id=organization_id,
        opened_at=opened_at,
        awarded_rate=Decimal("90.010"),
        award_method_code_value_id=unit_price,
    )
    seed_round(
        pipeline_services,
        evidence,
        organization_id=organization_id,
        opened_at=opened_at,
        awarded_rate=Decimal("90.010"),
        floor_rate=Decimal("88.000"),
        award_method_code_value_id=standard,
    )

    build_id, _ = _build(pipeline_services)

    rows = _rows(pipeline_services, build_id, organization_id)
    assert len(rows) == 3
    assert all(row[8] == 1 for row in rows)
    assert {(row[3], row[4]) for row in rows} == {
        (Decimal("90.000"), standard),
        (Decimal("90.000"), unit_price),
        (Decimal("88.000"), standard),
    }


def test_코호트_키가_비면_분포에_넣지_않는다(
    pipeline_services: PipelineServices,
) -> None:
    evidence = seed_evidence(pipeline_services)
    organization_id = seed_organization(pipeline_services, "미확인 코호트 학교")
    award_method = code_value(
        pipeline_services, namespace="eat:award-method", code="003"
    )
    # 개찰 시각 없음, 낙찰 방식 없음, 하한율 없음, 낙찰 판정 없음. 넷 다 코호트를 말할 수 없다.
    seed_round(
        pipeline_services,
        evidence,
        organization_id=organization_id,
        opened_at=None,
        awarded_rate=Decimal("90.010"),
        award_method_code_value_id=award_method,
    )
    seed_round(
        pipeline_services,
        evidence,
        organization_id=organization_id,
        opened_at=datetime(2026, 6, 10, 2, 0, tzinfo=UTC),
        awarded_rate=Decimal("90.010"),
        award_method_code_value_id=None,
    )
    seed_round(
        pipeline_services,
        evidence,
        organization_id=organization_id,
        opened_at=datetime(2026, 6, 10, 2, 0, tzinfo=UTC),
        awarded_rate=Decimal("90.010"),
        floor_rate=None,
        award_method_code_value_id=award_method,
    )
    seed_round(
        pipeline_services,
        evidence,
        organization_id=organization_id,
        opened_at=datetime(2026, 6, 10, 2, 0, tzinfo=UTC),
        awarded_rate=None,
        award_method_code_value_id=award_method,
    )

    build_id, _ = _build(pipeline_services)

    assert _rows(pipeline_services, build_id, organization_id) == []
