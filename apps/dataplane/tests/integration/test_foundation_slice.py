from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from hashlib import sha256
from pathlib import Path
from uuid import UUID

import pytest

from eatbid.core.postgres_repository import PsycopgCanonicalProjectionRepository
from eatbid.errors import SourceContractError
from eatbid.foundation import FoundationServices, run_foundation_slice
from eatbid.foundation_repository import FoundationIntegrityError
from eatbid.ingest.postgres_normalization_repository import (
    PsycopgNormalizationRepository,
)
from eatbid.ingest.postgres_publication_repository import PsycopgPublicationRepository
from eatbid.ingest.postgres_replay_repository import (
    PsycopgReplayRunRepository,
    ReplayIntegrityError,
)
from eatbid.ingest.postgres_repository import PsycopgObservationRepository
from eatbid.pipeline.capture import SourceThrottledError
from eatbid.pipeline.normalize import DataQuarantinedError
from eatbid.pipeline.replay import ReplayServices, replay_observations
from eatbid.postgres_foundation_repository import PsycopgFoundationCheckpointRepository
from eatbid.source.client import SourceResponse

from ..unit.fakes import MemoryRawObjectStore, StaticSourceClient
from .conftest import (
    FOUNDATION_ACTIVATED_AT,
    FOUNDATION_BUILD_SHA,
    FOUNDATION_FETCHED_AT,
    FOUNDATION_NORMALIZED_AT,
    FOUNDATION_STARTED_AT,
    FOUNDATION_VALIDATED_AT,
    FoundationHarness,
    MigratedDatabase,
    PipelineServices,
)

FIXTURE = Path(__file__).parents[1] / "fixtures" / "eat" / "bid-detail-one.xml"
EXTERNAL_BID_ID = "task-13-bid-detail-one"
FAILED_EXTERNAL_BID_ID = "task-13-count-mismatch"


def _concurrent_foundation(
    migrated_db: MigratedDatabase, *, run_id: UUID, publication_id: UUID
):
    connection = migrated_db.connect()
    try:
        return run_foundation_slice(
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
            request_params={"ELCTRN_BID_ID": "task-13-concurrent"},
            expected_count=1,
            services=FoundationServices(
                checkpoint_repository=PsycopgFoundationCheckpointRepository(connection),
                ingest_repository=PsycopgObservationRepository(connection),
                normalization_repository=PsycopgNormalizationRepository(connection),
                publication_repository=PsycopgPublicationRepository(connection),
                projection_repository=PsycopgCanonicalProjectionRepository(
                    connection, migrated_db.connect
                ),
                raw_store=MemoryRawObjectStore(
                    now=lambda: datetime(2026, 8, 29, 4, 5, 6, tzinfo=UTC)
                ),
                source_client=StaticSourceClient(
                    SourceResponse(200, FIXTURE.read_bytes(), FOUNDATION_FETCHED_AT)
                ),
            ),
        )
    finally:
        connection.close()


def test_raw_to_core와_replay_foundation_slice를_검증한다(
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

    resumed = foundation.run_fixture("eat/bid-detail-one.xml", expected_count=1)
    assert resumed == result
    with pytest.raises(FoundationIntegrityError):
        foundation.run_fixture("eat/bid-detail-one.xml", expected_count=2)

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


def test_유효하지_않은_foundation_chronology는_no_database_또는_raw_side_effect을_갖는다(
    pipeline_services: PipelineServices,
) -> None:
    run_id = UUID("13000000-0000-0000-0000-000000000021")
    publication_id = UUID("13000000-0000-0000-0000-000000000022")
    raw_before = pipeline_services.store.object_count
    client = StaticSourceClient(
        SourceResponse(200, FIXTURE.read_bytes(), FOUNDATION_FETCHED_AT)
    )

    with pytest.raises(ValueError, match="timestamps"):
        run_foundation_slice(
            run_id=run_id,
            publication_id=publication_id,
            mode="poll-open",
            build_sha=FOUNDATION_BUILD_SHA,
            parser_version="eat-v1",
            started_at=FOUNDATION_VALIDATED_AT,
            normalized_at=FOUNDATION_NORMALIZED_AT,
            validated_at=FOUNDATION_STARTED_AT,
            activated_at=FOUNDATION_ACTIVATED_AT,
            source="eat",
            endpoint="bid-detail",
            request_params={"ELCTRN_BID_ID": "task-13-invalid-chronology"},
            expected_count=1,
            services=FoundationServices(
                checkpoint_repository=pipeline_services.checkpoint_repository,
                ingest_repository=pipeline_services.repository,
                normalization_repository=pipeline_services.normalization_repository,
                publication_repository=pipeline_services.publication_repository,
                projection_repository=pipeline_services.projection_repository,
                raw_store=pipeline_services.store,
                source_client=client,
            ),
        )

    assert pipeline_services.store.object_count == raw_before
    assert client.requests == []
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute("select count(*) from ingest.run where run_id = %s", (run_id,))
        assert cursor.fetchone() == (0,)
        cursor.execute(
            "select count(*) from ingest.publication where publication_id = %s",
            (publication_id,),
        )
        assert cursor.fetchone() == (0,)


@pytest.mark.parametrize(
    ("run_id", "publication_id", "external_bid_id", "expected_count"),
    [
        (
            UUID("13000000-0000-0000-0000-000000000011"),
            UUID("13000000-0000-0000-0000-000000000012"),
            FAILED_EXTERNAL_BID_ID,
            2,
        ),
        (
            UUID("13000000-0000-0000-0000-000000000013"),
            UUID("13000000-0000-0000-0000-000000000014"),
            "task-13-zero-count-mismatch",
            0,
        ),
    ],
    ids=("over-count", "zero-count"),
)
def test_foundation가_에서_source_contract_전에_projection을_중단한다(
    pipeline_services: PipelineServices,
    run_id: UUID,
    publication_id: UUID,
    external_bid_id: str,
    expected_count: int,
) -> None:
    for _ in range(2):
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
                request_params={"ELCTRN_BID_ID": external_bid_id},
                expected_count=expected_count,
                services=FoundationServices(
                    checkpoint_repository=pipeline_services.checkpoint_repository,
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
            (external_bid_id,),
        )
        assert cursor.fetchone() == (0,)
        cursor.execute(
            "select count(*) from ingest.raw_observation where run_id = %s",
            (run_id,),
        )
        assert cursor.fetchone() == (1,)


def test_동일한_foundation_동시_호출이_수렴한다(
    migrated_db: MigratedDatabase,
) -> None:
    run_id = UUID("13000000-0000-0000-0000-000000000031")
    publication_id = UUID("13000000-0000-0000-0000-000000000032")
    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [
            executor.submit(
                _concurrent_foundation,
                migrated_db,
                run_id=run_id,
                publication_id=publication_id,
            )
            for _ in range(2)
        ]
        results = [future.result(timeout=20) for future in futures]

    assert results[0] == results[1]
    with migrated_db.connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            "select count(*) from ingest.raw_observation where run_id = %s",
            (run_id,),
        )
        assert cursor.fetchone() == (1,)
        cursor.execute(
            """
            select count(*) from ingest.publication_record pr
            join core.auction_revision ar using (normalized_record_id)
            where pr.publication_id = %s
            """,
            (publication_id,),
        )
        assert cursor.fetchone() == (1,)


def test_실패한_capture_retry가_중복_observation_없이_typed_failure를_다시_불러온다(
    pipeline_services: PipelineServices,
) -> None:
    run_id = UUID("13000000-0000-0000-0000-000000000051")
    publication_id = UUID("13000000-0000-0000-0000-000000000052")
    client = StaticSourceClient(
        SourceResponse(429, FIXTURE.read_bytes(), FOUNDATION_FETCHED_AT)
    )
    services = FoundationServices(
        checkpoint_repository=pipeline_services.checkpoint_repository,
        ingest_repository=pipeline_services.repository,
        normalization_repository=pipeline_services.normalization_repository,
        publication_repository=pipeline_services.publication_repository,
        projection_repository=pipeline_services.projection_repository,
        raw_store=pipeline_services.store,
        source_client=client,
    )
    for _ in range(2):
        with pytest.raises(SourceThrottledError):
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
                request_params={"ELCTRN_BID_ID": "task-13-throttled"},
                expected_count=1,
                services=services,
            )

    assert len(client.requests) == 1
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            """
            select r.status, r.failure_category, p.status, count(o.observation_id)
            from ingest.run r
            join ingest.publication p using (run_id)
            join ingest.raw_observation o using (run_id)
            where r.run_id = %s and p.publication_id = %s
            group by r.status, r.failure_category, p.status
            """,
            (run_id, publication_id),
        )
        assert cursor.fetchone() == ("failed", "SOURCE_THROTTLED", "pending", 1)


def test_capture_quarantine가_동일한_typed_failure_에서_retry을_다시_던진다(
    pipeline_services: PipelineServices,
) -> None:
    run_id = UUID("13000000-0000-0000-0000-000000000061")
    publication_id = UUID("13000000-0000-0000-0000-000000000062")
    client = StaticSourceClient(SourceResponse(200, b"<broken>", FOUNDATION_FETCHED_AT))
    services = FoundationServices(
        checkpoint_repository=pipeline_services.checkpoint_repository,
        ingest_repository=pipeline_services.repository,
        normalization_repository=pipeline_services.normalization_repository,
        publication_repository=pipeline_services.publication_repository,
        projection_repository=pipeline_services.projection_repository,
        raw_store=pipeline_services.store,
        source_client=client,
    )
    for _ in range(2):
        with pytest.raises(DataQuarantinedError):
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
                request_params={"ELCTRN_BID_ID": "task-13-quarantined"},
                expected_count=1,
                services=services,
            )

    assert len(client.requests) == 1
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            """
            select r.status, r.failure_category, p.status,
                   count(distinct a.normalization_attempt_id),
                   count(distinct ar.normalized_record_id)
            from ingest.run r
            join ingest.publication p using (run_id)
            join ingest.normalization_attempt a using (run_id)
            left join ingest.normalization_attempt_record ar
              using (normalization_attempt_id)
            where r.run_id = %s and p.publication_id = %s
            group by r.status, r.failure_category, p.status
            """,
            (run_id, publication_id),
        )
        assert cursor.fetchone() == ("failed", "DATA_QUARANTINED", "failed", 1, 0)
        cursor.execute(
            """
            select count(*) from core.auction_revision revision
            join ingest.normalized_record record using (normalized_record_id)
            where record.source_entity_id = 'task-13-quarantined'
            """
        )
        assert cursor.fetchone() == (0,)


@pytest.mark.parametrize(
    ("run_id", "publication_id", "tamper_sql"),
    [
        (
            UUID("13000000-0000-0000-0000-000000000071"),
            UUID("13000000-0000-0000-0000-000000000072"),
            """
            delete from core.auction_organization organization
            using core.auction_revision revision, ingest.publication_record member
            where organization.auction_revision_id = revision.auction_revision_id
              and revision.normalized_record_id = member.normalized_record_id
              and member.publication_id = %s
            """,
        ),
        (
            UUID("13000000-0000-0000-0000-000000000073"),
            UUID("13000000-0000-0000-0000-000000000074"),
            """
            update core.auction_revision revision set title = 'tampered'
            from ingest.publication_record member
            where revision.normalized_record_id = member.normalized_record_id
              and member.publication_id = %s
            """,
        ),
    ],
    ids=("missing-purchaser", "conflicting-revision"),
)
def test_발행된_reentry가_tampered_canonical_projection을_거부한다(
    migrated_db: MigratedDatabase,
    run_id: UUID,
    publication_id: UUID,
    tamper_sql: str,
) -> None:
    result = _concurrent_foundation(
        migrated_db, run_id=run_id, publication_id=publication_id
    )
    with migrated_db.connect() as connection, connection.cursor() as cursor:
        cursor.execute(tamper_sql, (result.publication_id,))
        assert cursor.rowcount == 1

    with pytest.raises(FoundationIntegrityError):
        _concurrent_foundation(
            migrated_db, run_id=run_id, publication_id=publication_id
        )


def test_foundation_및_replay_race는_하나_frozen_identity_없이_deadlock을_갖는다(
    foundation: FoundationHarness,
    migrated_db: MigratedDatabase,
) -> None:
    source = foundation.run_fixture("eat/bid-detail-one.xml", expected_count=1)
    run_id = UUID("13000000-0000-0000-0000-000000000041")
    foundation_publication_id = UUID("13000000-0000-0000-0000-000000000042")
    replay_publication_id = UUID("13000000-0000-0000-0000-000000000043")

    def run_replay():
        connection = migrated_db.connect()
        store = MemoryRawObjectStore()
        store.put(source="eat", endpoint="bid-detail", body=FIXTURE.read_bytes())
        try:
            return replay_observations(
                run_id=run_id,
                publication_id=replay_publication_id,
                observation_ids=source.observation_ids,
                build_sha=FOUNDATION_BUILD_SHA,
                parser_version="eat-v1",
                started_at=FOUNDATION_STARTED_AT,
                normalized_at=FOUNDATION_NORMALIZED_AT,
                validated_at=FOUNDATION_VALIDATED_AT,
                activated_at=FOUNDATION_ACTIVATED_AT,
                services=ReplayServices(
                    replay_repository=PsycopgReplayRunRepository(connection),
                    normalization_repository=PsycopgNormalizationRepository(connection),
                    publication_repository=PsycopgPublicationRepository(connection),
                    projection_repository=PsycopgCanonicalProjectionRepository(
                        connection, migrated_db.connect
                    ),
                    store=store,
                ),
            )
        finally:
            connection.close()

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = (
            executor.submit(
                _concurrent_foundation,
                migrated_db,
                run_id=run_id,
                publication_id=foundation_publication_id,
            ),
            executor.submit(run_replay),
        )
        outcomes: list[object] = []
        for future in futures:
            try:
                outcomes.append(future.result(timeout=20))
            except (FoundationIntegrityError, ReplayIntegrityError) as error:
                outcomes.append(error)

    assert sum(not isinstance(item, Exception) for item in outcomes) == 1
    assert (
        sum(
            isinstance(item, (FoundationIntegrityError, ReplayIntegrityError))
            for item in outcomes
        )
        == 1
    )
    with migrated_db.connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            "select mode, count(*) over () from ingest.run where run_id = %s",
            (run_id,),
        )
        run = cursor.fetchone()
        assert run is not None and run[1] == 1
        cursor.execute(
            "select publication_id from ingest.publication where run_id = %s",
            (run_id,),
        )
        publications = cursor.fetchall()
        assert len(publications) == 1
        assert (run[0], publications[0][0]) in {
            ("poll-open", foundation_publication_id),
            ("replay", replay_publication_id),
        }
