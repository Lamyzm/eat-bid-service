from __future__ import annotations

from hashlib import sha256
from pathlib import Path
from uuid import UUID

import pytest

from eatbid.errors import SourceContractError
from eatbid.foundation import FoundationServices, run_foundation_slice
from eatbid.source.client import SourceResponse

from ..unit.fakes import StaticSourceClient
from .conftest import (
    FOUNDATION_ACTIVATED_AT,
    FOUNDATION_BUILD_SHA,
    FOUNDATION_FETCHED_AT,
    FOUNDATION_NORMALIZED_AT,
    FOUNDATION_STARTED_AT,
    FOUNDATION_VALIDATED_AT,
    FoundationHarness,
    PipelineServices,
)

FIXTURE = Path(__file__).parents[1] / "fixtures" / "eat" / "bid-detail-one.xml"
EXTERNAL_BID_ID = "task-13-bid-detail-one"
FAILED_EXTERNAL_BID_ID = "task-13-count-mismatch"


def test_raw_to_core_and_replay_foundation_slice(
    foundation: FoundationHarness, pipeline_services: PipelineServices
) -> None:
    result = foundation.run_fixture("eat/bid-detail-one.xml", expected_count=1)
    expected_hash = sha256(FIXTURE.read_bytes()).hexdigest()
    expected_key = f"raw/eat/bid-detail/{expected_hash}.xml.gz"

    assert result.raw_blob_count == 1
    assert result.observation_count == 1
    assert result.publication_status == "published"
    assert result.organization_count == 1
    assert result.auction_attempt_count == 1
    assert result.auction_revision_count == 1
    assert result.raw_content_sha256 == expected_hash
    assert result.raw_object_key == expected_key

    observation_id = result.observation_ids[0]
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            """
            select r.mode, r.status, r.expected_count, r.captured_count,
                   r.published_count, u.request_unit_id, u.source, u.endpoint,
                   u.request_params, u.expected_count, u.observed_count, u.status,
                   o.run_id, o.request_unit_id, o.request_params, o.content_sha256
            from ingest.run r
            join ingest.request_unit u using (run_id)
            join ingest.raw_observation o using (run_id, request_unit_id)
            where r.run_id = %s and o.observation_id = %s
            """,
            (result.capture_run_id, observation_id),
        )
        assert cursor.fetchone() == (
            "poll-open",
            "published",
            1,
            1,
            1,
            result.request_unit_id,
            "eat",
            "bid-detail",
            {"ELCTRN_BID_ID": EXTERNAL_BID_ID},
            1,
            1,
            "captured",
            result.capture_run_id,
            result.request_unit_id,
            {"ELCTRN_BID_ID": EXTERNAL_BID_ID},
            expected_hash,
        )
        cursor.execute(
            """
            select b.content_sha256, b.object_key, b.byte_length,
                   count(o.observation_id)
            from ingest.raw_blob b
            join ingest.raw_observation o using (content_sha256)
            where b.content_sha256 = %s
              and o.observation_id = any(%s)
            group by b.content_sha256, b.object_key, b.byte_length
            """,
            (expected_hash, list(result.observation_ids)),
        )
        assert cursor.fetchone() == (
            expected_hash,
            expected_key,
            len(FIXTURE.read_bytes()),
            1,
        )
        cursor.execute(
            """
            select p.status, p.expected_count, p.normalized_count,
                   p.published_count, p.canonical_fingerprint,
                   a.run_id, a.observation_id, a.parser_version, a.status,
                   n.normalized_record_id, n.observation_id, n.record_type,
                   n.source_entity_id, n.parser_version
            from ingest.publication p
            join ingest.publication_record pr using (publication_id)
            join ingest.normalized_record n using (normalized_record_id)
            join ingest.normalization_attempt_record ar using (normalized_record_id)
            join ingest.normalization_attempt a using (normalization_attempt_id)
            where p.publication_id = %s and a.run_id = %s
            """,
            (result.publication_id, result.capture_run_id),
        )
        capture_lineage = cursor.fetchone()
        assert capture_lineage is not None
        assert capture_lineage[:9] == (
            "published",
            1,
            1,
            1,
            result.canonical_fingerprint,
            result.capture_run_id,
            observation_id,
            "eat-v1",
            "normalized",
        )
        normalized_record_id = capture_lineage[9]
        assert capture_lineage[10:] == (
            observation_id,
            "auction",
            EXTERNAL_BID_ID,
            "eat-v1",
        )
        cursor.execute(
            """
            select aa.auction_attempt_id, aa.source_system, aa.external_bid_id,
                   ar.auction_revision_id, ar.normalized_record_id,
                   ar.observation_id, ao.organization_id, o.type,
                   o.canonical_name, oi.observation_id,
                   oi.organization_identifier_id, oi.code_value_id,
                   identifier_scheme.namespace, identifier_value.code
            from core.auction_revision ar
            join core.auction_attempt aa using (auction_attempt_id)
            join core.auction_organization ao using (auction_revision_id)
            join core.organization o using (organization_id)
            join core.organization_identifier oi using (organization_id)
            join core.code_value identifier_value using (code_value_id)
            join core.code_scheme identifier_scheme using (code_scheme_id)
            where ar.normalized_record_id = %s
            """,
            (normalized_record_id,),
        )
        canonical = cursor.fetchone()
        assert canonical is not None
        assert all(
            isinstance(value, int)
            for value in (
                canonical[0],
                canonical[3],
                canonical[6],
                canonical[10],
                canonical[11],
            )
        )
        assert canonical[1:] == (
            "eat",
            EXTERNAL_BID_ID,
            canonical[3],
            normalized_record_id,
            observation_id,
            canonical[6],
            "unknown",
            None,
            observation_id,
            canonical[10],
            canonical[11],
            "eat:organization",
            "153347",
        )
        cursor.execute(
            """
            select s.namespace, v.code, r.role, r.code_value_id
            from core.auction_revision_code_value r
            join core.code_value v using (code_value_id)
            join core.code_scheme s using (code_scheme_id)
            join core.auction_revision ar using (auction_revision_id)
            where ar.normalized_record_id = %s
            order by s.namespace, v.code, r.role
            """,
            (normalized_record_id,),
        )
        code_relations = cursor.fetchall()
        assert [(row[0], row[1], row[2]) for row in code_relations] == [
            ("eat:auction-location-sido", "15", "location_sido"),
            ("eat:auction-location-sigungu", "653", "location_sigungu"),
            ("eat:eligibility-area", "15653", "eligibility_area"),
        ]
        assert all(isinstance(row[3], int) for row in code_relations)

    pipeline_services.connection.commit()
    replay = foundation.replay(result.observation_ids, parser_version="eat-v1")
    assert replay.run_id != result.capture_run_id
    assert replay.publication_id != result.publication_id
    assert replay.status == "published"
    assert replay.canonical_fingerprint == result.canonical_fingerprint

    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            "select observation_id from ingest.replay_input where run_id = %s",
            (replay.run_id,),
        )
        assert cursor.fetchall() == [(observation_id,)]
        cursor.execute(
            "select count(*) from ingest.raw_observation where run_id = %s",
            (replay.run_id,),
        )
        assert cursor.fetchone() == (0,)
        cursor.execute(
            """
            select a.run_id, ar.normalized_record_id
            from ingest.normalization_attempt a
            join ingest.normalization_attempt_record ar using (normalization_attempt_id)
            where a.observation_id = %s and a.parser_version = 'eat-v1'
              and a.run_id = any(%s)
            order by a.run_id
            """,
            (observation_id, [result.capture_run_id, replay.run_id]),
        )
        replay_lineage = cursor.fetchall()
        assert {row[0] for row in replay_lineage} == {
            result.capture_run_id,
            replay.run_id,
        }
        assert {row[1] for row in replay_lineage} == {normalized_record_id}
        cursor.execute(
            """
            select p.status, p.canonical_fingerprint, pr.normalized_record_id
            from ingest.publication p
            join ingest.publication_record pr using (publication_id)
            where p.publication_id = %s
            """,
            (replay.publication_id,),
        )
        assert cursor.fetchone() == (
            "published",
            result.canonical_fingerprint,
            normalized_record_id,
        )
        cursor.execute(
            """
            select count(distinct aa.auction_attempt_id),
                   count(distinct ar.auction_revision_id),
                   count(distinct ao.organization_id)
            from core.auction_attempt aa
            join core.auction_revision ar using (auction_attempt_id)
            join core.auction_organization ao using (auction_revision_id)
            where aa.source_system = 'eat' and aa.external_bid_id = %s
              and ar.normalized_record_id = %s
            """,
            (EXTERNAL_BID_ID, normalized_record_id),
        )
        assert cursor.fetchone() == (1, 1, 1)


def test_foundation_stops_on_source_contract_before_projection(
    pipeline_services: PipelineServices,
) -> None:
    run_id = UUID("13000000-0000-0000-0000-000000000011")
    publication_id = UUID("13000000-0000-0000-0000-000000000012")

    with pytest.raises(SourceContractError):
        run_foundation_slice(
            run_id=run_id,
            publication_id=publication_id,
            mode="poll-open",
            build_sha=FOUNDATION_BUILD_SHA,
            parser_version="eat-v1",
            started_at=FOUNDATION_STARTED_AT,
            normalized_at=FOUNDATION_NORMALIZED_AT,
            validated_at=FOUNDATION_VALIDATED_AT,
            activated_at=FOUNDATION_ACTIVATED_AT,
            source="eat",
            endpoint="bid-detail",
            request_params={"ELCTRN_BID_ID": FAILED_EXTERNAL_BID_ID},
            expected_count=2,
            services=FoundationServices(
                ingest_repository=pipeline_services.repository,
                normalization_repository=pipeline_services.normalization_repository,
                publication_repository=pipeline_services.publication_repository,
                projection_repository=pipeline_services.projection_repository,
                raw_store=pipeline_services.store,
                source_client=StaticSourceClient(
                    SourceResponse(200, FIXTURE.read_bytes(), FOUNDATION_FETCHED_AT)
                ),
            ),
        )

    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            """
            select r.status, r.failure_category, p.status,
                   p.canonical_fingerprint
            from ingest.run r
            join ingest.publication p using (run_id)
            where r.run_id = %s and p.publication_id = %s
            """,
            (run_id, publication_id),
        )
        assert cursor.fetchone() == (
            "failed",
            "SOURCE_CONTRACT",
            "failed",
            None,
        )
        cursor.execute(
            """
            select count(*) from core.auction_attempt
            where source_system = 'eat' and external_bid_id = %s
            """,
            (FAILED_EXTERNAL_BID_ID,),
        )
        assert cursor.fetchone() == (0,)
