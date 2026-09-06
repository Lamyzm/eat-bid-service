"""mart build의 지역 축 전환 규칙을 실제 PostgreSQL에서 고정한다.

전환은 새 `calc_version`의 새 build이며 한 build는 한 체계다. 여기서 확인하는 것은 그 사실이
질의로 닫히는가와, 닫히지 않을 때 build가 조용히 통과하지 않는가다(ADR 0034·0035).
"""

from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime
from decimal import Decimal
from uuid import uuid4

import pytest

from eatbid.core.region_mapping import EXACT_RELATION, OVERLAPS_RELATION
from eatbid.mart.region_axis import (
    assert_build_region_scheme,
    count_unmapped_region_codes,
)
from eatbid.mart.repository import MartBuildContractError
from eatbid.mart.win_rate_distribution import fill_win_rate_distribution

from .conftest import PipelineServices
from .mart_seed import (
    SeededEvidence,
    code_value,
    seed_evidence,
    seed_organization,
    seed_round,
)
from .mart_support import build_mart, create_source_release, fetch_all, mart_plan

DISTRIBUTION = "win_rate_distribution_monthly"
OPENED_AT = datetime(2026, 4, 12, 2, 0, tzinfo=UTC)

# 전환 규칙은 특정 정부 체계가 아니라 **release가 있는 canonical 체계**에 걸린다. test가 실제 행안부
# 체계를 쓰면 그 체계의 행 수를 세는 다른 test와 같은 DB를 오염시키고, 규칙이 이름에 묶인 것처럼도
# 읽힌다. 그래서 test마다 자기 canonical 체계를 만든다.
def _canonical_scheme() -> str:
    return f"test:canonical-region-{uuid4().hex[:8]}"


def _seed_code_release(services: PipelineServices, namespace: str) -> int:
    """행안부 체계의 release 하나를 심는다. release가 있어야 그 축이 강제된다."""
    source_release_id = create_source_release(services)
    with services.connection.cursor() as cursor:
        cursor.execute(
            """
            insert into core.code_scheme (namespace, owner, version_policy, valid_time_policy)
            values (%s, 'mois', 'release', 'closed')
            on conflict (namespace) do update set owner = excluded.owner
            returning code_scheme_id
            """,
            (namespace,),
        )
        scheme = cursor.fetchone()
        assert scheme is not None
        cursor.execute(
            """
            insert into core.code_release
              (source_release_id, code_scheme_id, source_version, published_at,
               promoted_grain, source_row_count, member_count, excluded_row_count)
            values (%s, %s, %s, null, array['sido','sigungu'], 2, 2, 0)
            returning code_release_id
            """,
            (source_release_id, scheme[0], f"test-{uuid4().hex}"),
        )
        release = cursor.fetchone()
        assert release is not None
    services.connection.commit()
    return int(release[0])


# 이 module이 만든 매핑 id다. 통합 test는 DB 하나를 함께 쓰므로 매핑 행을 남기면 "아직 매핑이
# 없다"를 고정하는 다른 test가 실행 순서에 따라 깨진다.
_CREATED_MAPPINGS: list[int] = []


@pytest.fixture(autouse=True)
def _remove_created_mappings(pipeline_services: PipelineServices):
    yield
    if not _CREATED_MAPPINGS:
        return
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            "delete from core.code_mapping where code_mapping_id = any(%s)",
            (_CREATED_MAPPINGS,),
        )
    pipeline_services.connection.commit()
    _CREATED_MAPPINGS.clear()


def _seed_mapping(
    services: PipelineServices,
    evidence: SeededEvidence,
    *,
    source_code_value_id: int,
    target_code_value_id: int,
    relation: str,
) -> None:
    with services.connection.cursor() as cursor:
        cursor.execute(
            """
            insert into core.code_mapping
              (from_code_value_id, to_code_value_id, relation, valid_from,
               evidence_observation_id, status)
            values (%s, %s, %s, %s, %s, 'label_verified')
            returning code_mapping_id
            """,
            (
                source_code_value_id,
                target_code_value_id,
                relation,
                OPENED_AT,
                evidence.observation_id,
            ),
        )
        created = cursor.fetchone()
        assert created is not None
        _CREATED_MAPPINGS.append(int(created[0]))
    services.connection.commit()


def test_행안부_체계를_선언한_build는_매핑된_지역만_행안부_코드로_싣는다(
    pipeline_services: PipelineServices,
) -> None:
    canonical_scheme = _canonical_scheme()
    _seed_code_release(pipeline_services, canonical_scheme)
    evidence = seed_evidence(pipeline_services)
    organization_id = seed_organization(pipeline_services, "지역 축 전환 학교")
    award_method = code_value(
        pipeline_services, namespace="eat:award-method", code="003"
    )
    sido = code_value(
        pipeline_services, namespace="eat:auction-location-sido", code=uuid4().hex[:6]
    )
    sigungu = code_value(
        pipeline_services,
        namespace="eat:auction-location-sigungu",
        code=uuid4().hex[:8],
    )
    canonical = code_value(
        pipeline_services,
        namespace=canonical_scheme,
        code=f"48{uuid4().hex[:8]}",
    )
    # 시군구만 대응을 만든다. 시도는 대응이 없으므로 지역 모집단에서 빠져야 한다.
    _seed_mapping(
        pipeline_services,
        evidence,
        source_code_value_id=sigungu,
        target_code_value_id=canonical,
        relation=EXACT_RELATION,
    )
    seed_round(
        pipeline_services,
        evidence,
        organization_id=organization_id,
        opened_at=OPENED_AT,
        awarded_rate=Decimal("90.010"),
        award_method_code_value_id=award_method,
        sido_code_value_id=sido,
        sigungu_code_value_id=sigungu,
    )

    plan = replace(
        mart_plan(create_source_release(pipeline_services), mart_name=DISTRIBUTION),
        region_scheme=canonical_scheme,
        calc_version="mart-r3",
    )
    build_id, _ = build_mart(pipeline_services, plan, fill_win_rate_distribution)

    rows = fetch_all(
        pipeline_services,
        """
        select scope, region_code_value_id
          from mart.win_rate_distribution_monthly
         where build_id = %s and region_code_value_id is not null
         order by scope
        """,
        (build_id,),
    )
    assert rows == [("district", canonical)]
    # 선언한 체계 밖의 코드가 남지 않았으므로 검증이 통과한다.
    assert_build_region_scheme(pipeline_services.connection, plan=plan, build_id=build_id)


def test_overlaps_매핑은_번역하지_않고_미매핑으로_센다(
    pipeline_services: PipelineServices,
) -> None:
    canonical_scheme = _canonical_scheme()
    _seed_code_release(pipeline_services, canonical_scheme)
    evidence = seed_evidence(pipeline_services)
    organization_id = seed_organization(pipeline_services, "겹치는 구역 학교")
    award_method = code_value(
        pipeline_services, namespace="eat:award-method", code="003"
    )
    sigungu = code_value(
        pipeline_services,
        namespace="eat:auction-location-sigungu",
        code=uuid4().hex[:8],
    )
    canonical = code_value(
        pipeline_services,
        namespace=canonical_scheme,
        code=f"12{uuid4().hex[:8]}",
    )
    _seed_mapping(
        pipeline_services,
        evidence,
        source_code_value_id=sigungu,
        target_code_value_id=canonical,
        relation=OVERLAPS_RELATION,
    )
    seed_round(
        pipeline_services,
        evidence,
        organization_id=organization_id,
        opened_at=OPENED_AT,
        awarded_rate=Decimal("90.020"),
        award_method_code_value_id=award_method,
        sigungu_code_value_id=sigungu,
    )

    plan = replace(
        mart_plan(create_source_release(pipeline_services), mart_name=DISTRIBUTION),
        region_scheme=canonical_scheme,
        calc_version="mart-r3",
    )
    build_id, _ = build_mart(pipeline_services, plan, fill_win_rate_distribution)

    translated = fetch_all(
        pipeline_services,
        """
        select count(*)
          from mart.win_rate_distribution_monthly
         where build_id = %s and region_code_value_id = %s
        """,
        (build_id, canonical),
    )
    assert translated == [(0,)]
    # 번역하지 못한 코드는 조용히 사라지지 않고 세어진다.
    assert count_unmapped_region_codes(pipeline_services.connection, plan=plan) > 0


def test_build가_선언한_체계_밖의_코드를_쓰면_verified로_올라가지_않는다(
    pipeline_services: PipelineServices,
) -> None:
    canonical_scheme = _canonical_scheme()
    _seed_code_release(pipeline_services, canonical_scheme)
    evidence = seed_evidence(pipeline_services)
    organization_id = seed_organization(pipeline_services, "체계 검증 학교")
    award_method = code_value(
        pipeline_services, namespace="eat:award-method", code="003"
    )
    sigungu = code_value(
        pipeline_services,
        namespace="eat:auction-location-sigungu",
        code=uuid4().hex[:8],
    )
    seed_round(
        pipeline_services,
        evidence,
        organization_id=organization_id,
        opened_at=OPENED_AT,
        awarded_rate=Decimal("90.030"),
        award_method_code_value_id=award_method,
        sigungu_code_value_id=sigungu,
    )

    observed_plan = mart_plan(
        create_source_release(pipeline_services), mart_name=DISTRIBUTION
    )
    build_id, _ = build_mart(
        pipeline_services, observed_plan, fill_win_rate_distribution
    )

    # 같은 행을 행안부 체계라고 주장하는 계획으로 검증하면 통과하지 못한다.
    canonical_plan = replace(
        observed_plan, region_scheme=canonical_scheme
    )
    with pytest.raises(MartBuildContractError):
        assert_build_region_scheme(
            pipeline_services.connection, plan=canonical_plan, build_id=build_id
        )
