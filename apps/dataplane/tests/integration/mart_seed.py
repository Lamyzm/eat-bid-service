"""분포 mart test가 코호트 축을 손으로 정해 core 회차를 심는 helper.

원본 XML 하나로는 하한율·낙찰 방식·지역·달을 원하는 조합으로 만들 수 없어 코호트 규칙을 고정하지
못한다. 그래서 계산 정의를 확인하는 test만 core 행을 직접 심고, 파서와 발행 경로의 진위는
`test_project_v2.py`와 `test_mart_org_round_summary.py`가 별도로 확인한다.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from uuid import uuid4

from .conftest import PipelineServices


@dataclass(frozen=True, slots=True)
class SeededEvidence:
    observation_id: int
    source_supplier_account_id: int
    supplier_party_id: int
    status_code_value_id: int


def code_value(services: PipelineServices, *, namespace: str, code: str) -> int:
    with services.connection.cursor() as cursor:
        cursor.execute(
            """
            insert into core.code_scheme (namespace, owner, version_policy, valid_time_policy)
            values (%s, 'eat', 'immutable', 'open')
            on conflict (namespace) do update set owner = excluded.owner
            returning code_scheme_id
            """,
            (namespace,),
        )
        scheme = cursor.fetchone()
        assert scheme is not None
        cursor.execute(
            """
            insert into core.code_value (code_scheme_id, code)
            values (%s, %s)
            on conflict (code_scheme_id, code) do update set code = excluded.code
            returning code_value_id
            """,
            (scheme[0], code),
        )
        value = cursor.fetchone()
        assert value is not None
    services.connection.commit()
    return int(value[0])


def seed_evidence(services: PipelineServices) -> SeededEvidence:
    """관측 근거와 업체 계정을 한 벌 만든다. 심은 회차들이 이 근거를 공유한다."""
    run_id = uuid4()
    content_sha256 = uuid4().hex + uuid4().hex
    status_code_value_id = code_value(
        services, namespace="eat:bid-status", code="002"
    )
    with services.connection.cursor() as cursor:
        cursor.execute(
            """
            insert into ingest.run
              (run_id, mode, status, build_sha, parser_version, started_at,
               expected_count, captured_count, published_count)
            values (%s, 'backfill', 'planned', %s, 'eat-v2', now(), 0, 0, 0)
            """,
            (run_id, "f" * 64),
        )
        cursor.execute(
            """
            insert into ingest.request_unit
              (run_id, source, endpoint, request_params, request_params_hash,
               expected_count, observed_count, status)
            values (%s, 'eat', '/bid-detail', '{}'::jsonb, %s, 0, 0, 'captured')
            returning request_unit_id
            """,
            (run_id, uuid4().hex + uuid4().hex),
        )
        request_unit = cursor.fetchone()
        assert request_unit is not None
        cursor.execute(
            """
            insert into ingest.raw_blob
              (content_sha256, object_key, byte_length, content_type, content_encoding, stored_at)
            values (%s, %s, 10, 'application/xml', 'gzip', now())
            """,
            (content_sha256, f"raw/eat/bid-detail/{content_sha256}.xml.gz"),
        )
        cursor.execute(
            """
            insert into ingest.raw_observation
              (run_id, request_unit_id, source, endpoint, request_params,
               fetched_at, http_status, content_sha256)
            values (%s, %s, 'eat', '/bid-detail', '{}'::jsonb, now(), 200, %s)
            returning observation_id
            """,
            (run_id, request_unit[0], content_sha256),
        )
        observation = cursor.fetchone()
        assert observation is not None
        cursor.execute(
            "insert into core.supplier_party (type, canonical_name) "
            "values ('company', %s) returning supplier_party_id",
            (f"합성 업체 {uuid4().hex[:8]}",),
        )
        party = cursor.fetchone()
        assert party is not None
    services.connection.commit()

    account_code_value_id = code_value(
        services, namespace="eat:supplier-account", code=uuid4().hex[:12]
    )
    with services.connection.cursor() as cursor:
        cursor.execute(
            """
            insert into core.source_supplier_account
              (supplier_party_id, source_system, account_code_value_id, observation_id)
            values (%s, 'eat', %s, %s)
            returning source_supplier_account_id
            """,
            (party[0], account_code_value_id, observation[0]),
        )
        account = cursor.fetchone()
        assert account is not None
    services.connection.commit()

    return SeededEvidence(
        observation_id=int(observation[0]),
        source_supplier_account_id=int(account[0]),
        supplier_party_id=int(party[0]),
        status_code_value_id=status_code_value_id,
    )


def seed_organization(services: PipelineServices, name: str) -> int:
    with services.connection.cursor() as cursor:
        cursor.execute(
            "insert into core.organization (type, canonical_name) values ('school', %s) "
            "returning organization_id",
            (name,),
        )
        row = cursor.fetchone()
        assert row is not None
    services.connection.commit()
    return int(row[0])


def seed_round(
    services: PipelineServices,
    evidence: SeededEvidence,
    *,
    organization_id: int,
    opened_at: datetime | None,
    awarded_rate: Decimal | None,
    floor_rate: Decimal | None = Decimal("90.000"),
    award_method_code_value_id: int | None = None,
    sido_code_value_id: int | None = None,
    sigungu_code_value_id: int | None = None,
    base_amount: Decimal = Decimal("1000000.00"),
    planned_amount: Decimal = Decimal("1000000.00"),
) -> int:
    """회차 하나를 core에 심고 attempt id를 돌려준다."""
    external_bid_id = f"synthetic-{uuid4().hex}"
    with services.connection.cursor() as cursor:
        cursor.execute(
            "insert into core.auction_attempt (source_system, external_bid_id) "
            "values ('eat', %s) returning auction_attempt_id",
            (external_bid_id,),
        )
        attempt = cursor.fetchone()
        assert attempt is not None
        cursor.execute(
            """
            insert into ingest.normalized_record
              (observation_id, record_type, source_entity_id, normalized_payload,
               parser_version, normalized_at)
            values (%s, 'auction.v2', %s, '{"lineage": {"links": []}}'::jsonb, 'eat-v2', now())
            returning normalized_record_id
            """,
            (evidence.observation_id, external_bid_id),
        )
        record = cursor.fetchone()
        assert record is not None
        cursor.execute(
            """
            insert into core.auction_revision
              (auction_attempt_id, normalized_record_id, observation_id, content_sha256,
               source_status, title, announced_at, opened_at, floor_rate,
               base_amount, planned_amount, currency, source_payload)
            values (%s, %s, %s, %s, 'CLOSED', '합성 회차', now(), %s, %s, %s, %s, 'KRW',
                    '{"lineage": {"links": []}}'::jsonb)
            returning auction_revision_id
            """,
            (
                attempt[0],
                record[0],
                evidence.observation_id,
                uuid4().hex + uuid4().hex,
                opened_at,
                floor_rate,
                base_amount,
                planned_amount,
            ),
        )
        revision = cursor.fetchone()
        assert revision is not None
        cursor.execute(
            "insert into core.auction_organization (auction_revision_id, organization_id, role) "
            "values (%s, %s, 'purchaser')",
            (revision[0], organization_id),
        )
        for code_value_id, role in (
            (award_method_code_value_id, "award_method"),
            (sido_code_value_id, "location_sido"),
            (sigungu_code_value_id, "location_sigungu"),
        ):
            if code_value_id is not None:
                cursor.execute(
                    "insert into core.auction_revision_code_value "
                    "(auction_revision_id, code_value_id, role) values (%s, %s, %s)",
                    (revision[0], code_value_id, role),
                )
        if awarded_rate is not None:
            cursor.execute(
                """
                insert into core.award_decision
                  (auction_revision_id, auction_attempt_id, awarded_roster_ordinal,
                   source_supplier_account_id, supplier_party_id, awarded_amount, currency,
                   awarded_rate, source_status_code_value_id, observation_id)
                values (%s, %s, 0, %s, %s, %s, 'KRW', %s, %s, %s)
                """,
                (
                    revision[0],
                    attempt[0],
                    evidence.source_supplier_account_id,
                    evidence.supplier_party_id,
                    base_amount,
                    awarded_rate,
                    evidence.status_code_value_id,
                    evidence.observation_id,
                ),
            )
    services.connection.commit()
    return int(attempt[0])
