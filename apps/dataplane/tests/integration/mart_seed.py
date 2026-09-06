"""분포 mart test가 코호트 축을 손으로 정해 core 회차를 심는 helper.

원본 XML 하나로는 하한율·낙찰 방식·지역·달을 원하는 조합으로 만들 수 없어 코호트 규칙을 고정하지
못한다. 그래서 계산 정의를 확인하는 test만 core 행을 직접 심고, 파서와 발행 경로의 진위는
`test_project_v2.py`와 `test_mart_org_round_summary.py`가 별도로 확인한다.
"""

from __future__ import annotations

import json
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


def seed_organization_identity(
    services: PipelineServices,
    *,
    organization_id: int,
    code: str,
    label: str | None,
    observation_id: int,
) -> int:
    """조직을 관측된 코드로 잇고 그 코드의 이름 관측을 남긴다. code value id를 돌려준다.

    이름은 `core.organization.canonical_name`이 아니라 `core.code_label_observation`으로 간다.
    관측된 표시 이름을 정체성 자리에 올리지 않는 실제 발행 경로와 같은 모양이다(AGENTS 2).
    """
    code_value_id = code_value(services, namespace="eat:organization", code=code)
    with services.connection.cursor() as cursor:
        cursor.execute(
            "insert into core.organization_identifier "
            "(organization_id, code_value_id, observation_id) values (%s, %s, %s) "
            "on conflict on constraint organization_identifier_code_value_key do nothing",
            (organization_id, code_value_id, observation_id),
        )
        if label is not None:
            cursor.execute(
                """
                insert into core.code_label_observation
                  (code_value_id, label, language, observed_at, observation_id)
                values (%s, %s, 'und', now(), %s)
                on conflict on constraint code_label_observation_evidence_key do nothing
                """,
                (code_value_id, label, observation_id),
            )
    services.connection.commit()
    return code_value_id


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
    external_bid_id: str | None = None,
    item_label: str | None = None,
) -> int:
    """회차 하나를 core에 심고 attempt id를 돌려준다.

    `external_bid_id`를 주면 이미 있는 attempt에 revision을 덧붙인다. 목록에서 먼저 만들어진
    identity 전용 attempt에 상세 해석을 얹는 상황을 test가 그대로 재현하기 위한 통로다.
    """
    external_bid_id = external_bid_id or f"synthetic-{uuid4().hex}"
    payload = json.dumps(
        {
            "lineage": {"links": []},
            **(
                {"classification": {"sourceCategoryLabel": item_label}}
                if item_label is not None
                else {}
            ),
        }
    )
    with services.connection.cursor() as cursor:
        cursor.execute(
            "insert into core.auction_attempt (source_system, external_bid_id) "
            "values ('eat', %s) "
            "on conflict on constraint auction_attempt_source_external_bid_key do nothing",
            (external_bid_id,),
        )
        cursor.execute(
            "select auction_attempt_id from core.auction_attempt "
            "where source_system = 'eat' and external_bid_id = %s",
            (external_bid_id,),
        )
        attempt = cursor.fetchone()
        assert attempt is not None
        cursor.execute(
            """
            insert into ingest.normalized_record
              (observation_id, record_type, source_entity_id, normalized_payload,
               parser_version, normalized_at)
            values (%s, 'auction.v2', %s, %s::jsonb, 'eat-v2', now())
            returning normalized_record_id
            """,
            (evidence.observation_id, external_bid_id, payload),
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
                    %s::jsonb)
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
                payload,
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
