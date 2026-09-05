from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import UUID, uuid4

import psycopg
import pytest

from eatbid.core.models import ExternalCodeRef
from eatbid.core.postgres_repository import PsycopgCanonicalProjectionRepository
from eatbid.core.repository import ProjectionContractError
from eatbid.pipeline.project import build_eat_auction_projection, project_publication
from eatbid.pipeline.validate import validate_run

from .conftest import MigratedDatabase, PipelineServices
from .test_normalize_validate import (
    BUILD_SHA,
    FETCHED_AT,
    NORMALIZED_AT,
    VALIDATED_AT,
    capture_detail,
    normalize_one,
    start_replay_run,
    start_run,
)

ACTIVATED_AT = VALIDATED_AT + timedelta(minutes=1)
FIXTURE = Path(__file__).parents[1] / "fixtures" / "eat" / "bid-detail-one.xml"


def validated_from_values(
    services: PipelineServices,
    *,
    external_bid_id: str,
    organization_code: str = "153347",
    organization_name: str = "비식별 구매기관",
    display_bid_no: str | None = "E250617-472599-1",
    sido_code: str = "15",
    sigungu_code: str = "653",
    eligibility_code: str = "15653",
) -> UUID:
    body = FIXTURE.read_bytes()
    body = body.replace(b"153347", organization_code.encode())
    body = body.replace("비식별 구매기관".encode(), organization_name.encode())
    body = body.replace(b">15</Col>", f">{sido_code}</Col>".encode(), 1)
    body = body.replace(b">653</Col>", f">{sigungu_code}</Col>".encode(), 1)
    body = body.replace(b">15653</Col>", f">{eligibility_code}</Col>".encode(), 1)
    if display_bid_no is None:
        body = body.replace(b'<Col id="ELCTRN_BID_NO">E250617-472599-1</Col>', b"")
    else:
        body = body.replace(b"E250617-472599-1", display_bid_no.encode())
    run_id = start_run(services)
    observation_id = capture_detail(
        services,
        run_id=run_id,
        external_bid_id=external_bid_id,
        body=body,
    )
    normalize_one(services, observation_id)
    publication_id = uuid4()
    result = validate_run(
        run_id=run_id,
        publication_id=publication_id,
        validated_at=VALIDATED_AT,
        repository=services.publication_repository,
    )
    assert result.status == "validated"
    services.connection.commit()
    return publication_id


def project(services: PipelineServices, publication_id: UUID):
    return project_publication(
        publication_id=publication_id,
        projector_version=BUILD_SHA,
        activated_at=ACTIVATED_AT,
        repository=services.projection_repository,
    )


def test_repository가_locked_member에_묶이지_않은_factory_output을_거부한다(
    pipeline_services: PipelineServices,
) -> None:
    publication_id = validated_from_values(
        pipeline_services, external_bid_id="dishonest-factory"
    )

    def dishonest(member):
        return replace(
            build_eat_auction_projection(member),
            normalized_payload_sha256="0" * 64,
        )

    with pytest.raises(ProjectionContractError, match="factory output"):
        pipeline_services.projection_repository.project_publication(
            publication_id=publication_id,
            projector_version=BUILD_SHA,
            activated_at=ACTIVATED_AT,
            projection_factory=dishonest,
        )

    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            "select p.status, r.failure_category from ingest.publication p "
            "join ingest.run r using (run_id) where p.publication_id = %s",
            (publication_id,),
        )
        assert cursor.fetchone() == ("failed", "PROJECTION_CONTRACT")


@pytest.mark.parametrize(
    "changes",
    [
        {"normalized_record_id": 0},
        {"normalized_record_id": True},
        {"normalized_record_id": "1"},
        {"observation_id": 0},
        {"observation_id": False},
        {"observation_id": "2"},
        {"raw_content_sha256": "A" * 64},
        {"source_status": ""},
        {"title": ""},
        {"currency": ""},
        {"source_payload": []},
        {"source_payload": {"not_json": object()}},
        {"code_refs": ("bad",)},
        {
            "code_refs": (
                ExternalCodeRef("eat:eligibility-area", 1, "eligibility_area"),
            )
        },
        {"code_refs": (ExternalCodeRef("eat:eligibility-area", "01", None),)},
        {"code_refs": (ExternalCodeRef("invented:scheme", "01", "eligibility_area"),)},
        {
            "code_refs": (
                ExternalCodeRef("eat:eligibility-area", "01", "eligibility_area"),
                ExternalCodeRef("eat:eligibility-area", "01", "eligibility_area"),
            )
        },
    ],
)
def test_repository가_SQL_전에_malformed_factory_projection을_거부한다(
    pipeline_services: PipelineServices, changes: dict[str, object]
) -> None:
    publication_id = validated_from_values(
        pipeline_services, external_bid_id=f"malformed-{uuid4()}"
    )

    def malformed(member):
        return replace(build_eat_auction_projection(member), **changes)

    with pytest.raises(ProjectionContractError, match="projection"):
        pipeline_services.projection_repository.project_publication(
            publication_id=publication_id,
            projector_version=BUILD_SHA,
            activated_at=ACTIVATED_AT,
            projection_factory=malformed,
        )

    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            "select count(*) from core.auction_revision ar "
            "join ingest.publication_record pr using (normalized_record_id) "
            "where pr.publication_id = %s",
            (publication_id,),
        )
        assert cursor.fetchone() == (0,)
        cursor.execute(
            "select p.status, r.failure_category from ingest.publication p "
            "join ingest.run r using (run_id) where p.publication_id = %s",
            (publication_id,),
        )
        assert cursor.fetchone() == ("failed", "PROJECTION_CONTRACT")


def test_repository가_non_projection_factory_output을_contract_failure로_거부한다(
    pipeline_services: PipelineServices,
) -> None:
    publication_id = validated_from_values(
        pipeline_services, external_bid_id="non-projection-output"
    )

    with pytest.raises(ProjectionContractError, match="AuctionProjection"):
        pipeline_services.projection_repository.project_publication(
            publication_id=publication_id,
            projector_version=BUILD_SHA,
            activated_at=ACTIVATED_AT,
            projection_factory=lambda _member: "bad",  # type: ignore[arg-type,return-value]
        )

    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            "select p.status, r.failure_category from ingest.publication p "
            "join ingest.run r using (run_id) where p.publication_id = %s",
            (publication_id,),
        )
        assert cursor.fetchone() == ("failed", "PROJECTION_CONTRACT")


def test_projector가_candidate_하나의_multiple_normalized_member를_거부한다(
    pipeline_services: PipelineServices,
) -> None:
    publication_id = validated_from_values(
        pipeline_services, external_bid_id="extra-normalized-member"
    )
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            "select a.normalization_attempt_id, n.observation_id, n.normalized_payload "
            "from ingest.publication_record pr "
            "join ingest.normalized_record n using (normalized_record_id) "
            "join ingest.normalization_attempt_record ar using (normalized_record_id) "
            "join ingest.normalization_attempt a using (normalization_attempt_id) "
            "where pr.publication_id = %s",
            (publication_id,),
        )
        attempt_id, observation_id, payload = cursor.fetchone()
        cursor.execute(
            "insert into ingest.normalized_record "
            "(observation_id, record_type, source_entity_id, normalized_payload, "
            "parser_version, normalized_at) values "
            "(%s, 'auction.v1', 'extra-member', %s, 'eat-v1', %s) "
            "returning normalized_record_id",
            (observation_id, psycopg.types.json.Jsonb(payload), NORMALIZED_AT),
        )
        extra_id = cursor.fetchone()[0]
        cursor.execute(
            "insert into ingest.normalization_attempt_record "
            "(normalization_attempt_id, normalized_record_id) values (%s, %s)",
            (attempt_id, extra_id),
        )
    pipeline_services.connection.commit()

    with pytest.raises(ProjectionContractError, match="candidate topology"):
        project(pipeline_services, publication_id)


def test_projector가_validation_후_추가된_wrong_parser_attempt를_거부한다(
    pipeline_services: PipelineServices,
) -> None:
    publication_id = validated_from_values(
        pipeline_services, external_bid_id="projection-wrong-parser-attempt"
    )
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            "insert into ingest.normalization_attempt "
            "(run_id, observation_id, parser_version, status, attempted_at, "
            "schema_fingerprint, quarantine_reason) "
            "select p.run_id, n.observation_id, 'eat-v2', 'quarantined', %s, "
            "null, 'synthetic parser mismatch' "
            "from ingest.publication p "
            "join ingest.publication_record pr using (publication_id) "
            "join ingest.normalized_record n using (normalized_record_id) "
            "where p.publication_id = %s",
            (NORMALIZED_AT + timedelta(minutes=1), publication_id),
        )
        assert cursor.rowcount == 1
    pipeline_services.connection.commit()

    with pytest.raises(ProjectionContractError, match="candidate topology"):
        project(pipeline_services, publication_id)


def test_candidate_bijection은_normalized_record_id_순서를_가정하지_않는다(
    pipeline_services: PipelineServices,
) -> None:
    run_id = start_run(pipeline_services, expected_count=2)
    first_observation = capture_detail(
        pipeline_services, run_id=run_id, external_bid_id="reverse-order-first"
    )
    second_observation = capture_detail(
        pipeline_services, run_id=run_id, external_bid_id="reverse-order-second"
    )
    second_record = normalize_one(pipeline_services, second_observation)
    first_record = normalize_one(pipeline_services, first_observation)
    assert first_observation < second_observation
    assert second_record.normalized_record_id < first_record.normalized_record_id
    publication_id = uuid4()
    result = validate_run(
        run_id=run_id,
        publication_id=publication_id,
        validated_at=VALIDATED_AT,
        repository=pipeline_services.publication_repository,
    )
    assert len(result.member_ids) == 2
    pipeline_services.connection.commit()

    projected = project(pipeline_services, publication_id)

    assert projected.members_projected == 2


def test_projector가_validation_후_추가된_replay_candidate를_거부한다(
    pipeline_services: PipelineServices,
) -> None:
    first_publication = validated_from_values(
        pipeline_services, external_bid_id="replay-candidate-first"
    )
    second_publication = validated_from_values(
        pipeline_services, external_bid_id="replay-candidate-second"
    )
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            "select n.observation_id from ingest.publication_record pr "
            "join ingest.normalized_record n using (normalized_record_id) "
            "where pr.publication_id = %s",
            (first_publication,),
        )
        first_observation = cursor.fetchone()[0]
        cursor.execute(
            "select n.observation_id from ingest.publication_record pr "
            "join ingest.normalized_record n using (normalized_record_id) "
            "where pr.publication_id = %s",
            (second_publication,),
        )
        second_observation = cursor.fetchone()[0]
    pipeline_services.connection.commit()
    replay_run, replay_publication = start_replay_run(
        pipeline_services, (first_observation,)
    )
    normalize_one(pipeline_services, first_observation, processing_run_id=replay_run)
    validate_run(
        run_id=replay_run,
        publication_id=replay_publication,
        validated_at=VALIDATED_AT,
        repository=pipeline_services.publication_repository,
    )
    pipeline_services.connection.commit()
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            "insert into ingest.replay_input (run_id, observation_id) values (%s, %s)",
            (replay_run, second_observation),
        )
    pipeline_services.connection.commit()

    with pytest.raises(ProjectionContractError, match="candidate topology"):
        project(pipeline_services, replay_publication)


def test_projector가_발행된_retry의_extra_revision_relation을_거부한다(
    pipeline_services: PipelineServices,
) -> None:
    first = validated_from_values(
        pipeline_services,
        external_bid_id="exact-relations-first",
        organization_code="710001",
        eligibility_code="71001",
    )
    second = validated_from_values(
        pipeline_services,
        external_bid_id="exact-relations-second",
        organization_code="710002",
        eligibility_code="71002",
    )
    project(pipeline_services, first)
    project(pipeline_services, second)
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            "select ar.auction_revision_id from core.auction_revision ar "
            "join core.auction_attempt aa using (auction_attempt_id) "
            "where aa.external_bid_id = 'exact-relations-first'"
        )
        revision_id = cursor.fetchone()[0]
        cursor.execute(
            "select ao.organization_id from core.auction_organization ao "
            "join core.auction_revision ar using (auction_revision_id) "
            "join core.auction_attempt aa using (auction_attempt_id) "
            "where aa.external_bid_id = 'exact-relations-second'"
        )
        extra_organization_id = cursor.fetchone()[0]
        cursor.execute(
            "select r.code_value_id from core.auction_revision_code_value r "
            "join core.auction_revision ar using (auction_revision_id) "
            "join core.auction_attempt aa using (auction_attempt_id) "
            "where aa.external_bid_id = 'exact-relations-second' "
            "and r.role = 'eligibility_area'"
        )
        extra_code_id = cursor.fetchone()[0]
        cursor.execute(
            "insert into core.auction_organization "
            "(auction_revision_id, organization_id, role) values (%s, %s, 'purchaser')",
            (revision_id, extra_organization_id),
        )
        cursor.execute(
            "insert into core.auction_revision_code_value "
            "(auction_revision_id, code_value_id, role) values (%s, %s, 'eligibility_area')",
            (revision_id, extra_code_id),
        )
    pipeline_services.connection.commit()

    with pytest.raises(ProjectionContractError, match="relationship set"):
        project(pipeline_services, first)


def test_projection이_idle_owned_transaction_scope을_요구한다(
    pipeline_services: PipelineServices,
) -> None:
    publication_id = validated_from_values(
        pipeline_services, external_bid_id="ambient-transaction"
    )
    with (
        pipeline_services.connection.transaction(),
        pytest.raises(RuntimeError, match="idle transaction"),
    ):
        project(pipeline_services, publication_id)

    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            "select status from ingest.publication where publication_id = %s",
            (publication_id,),
        )
        assert cursor.fetchone() == ("validated",)


def test_projection이_validation_이전_activation을_거부한다(
    pipeline_services: PipelineServices,
) -> None:
    publication_id = validated_from_values(
        pipeline_services, external_bid_id="activation-chronology"
    )

    with pytest.raises(ProjectionContractError, match="activation chronology"):
        project_publication(
            publication_id=publication_id,
            projector_version=BUILD_SHA,
            activated_at=VALIDATED_AT - timedelta(seconds=1),
            repository=pipeline_services.projection_repository,
        )
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            "select r.ended_at, p.validated_at from ingest.publication p "
            "join ingest.run r using (run_id) where p.publication_id = %s",
            (publication_id,),
        )
        ended_at, validated_at = cursor.fetchone()
        assert ended_at == validated_at


def test_projection이_run_start_이전_activation을_contract_failure로_거부한다(
    pipeline_services: PipelineServices,
) -> None:
    publication_id = validated_from_values(
        pipeline_services, external_bid_id="activation-before-start"
    )

    with pytest.raises(ProjectionContractError, match="activation chronology"):
        project_publication(
            publication_id=publication_id,
            projector_version=BUILD_SHA,
            activated_at=FETCHED_AT - timedelta(seconds=1),
            repository=pipeline_services.projection_repository,
        )

    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            "select p.status, r.failure_category, r.ended_at "
            "from ingest.publication p join ingest.run r using (run_id) "
            "where p.publication_id = %s",
            (publication_id,),
        )
        status, category, ended_at = cursor.fetchone()
        assert (status, category) == ("failed", "PROJECTION_CONTRACT")
        assert ended_at == VALIDATED_AT


def test_database가_run_start_이전_end를_거부한다(
    pipeline_services: PipelineServices,
) -> None:
    run_id = start_run(pipeline_services)
    with (
        pytest.raises(psycopg.errors.CheckViolation, match="run_end_chronology"),
        pipeline_services.connection.transaction(),
        pipeline_services.connection.cursor() as cursor,
    ):
        cursor.execute(
            "update ingest.run set status = 'failed', failure_category = 'TEST', "
            "ended_at = %s where run_id = %s",
            (FETCHED_AT - timedelta(seconds=1), run_id),
        )


def test_database가_validation_이전_publication_activation을_거부한다(
    pipeline_services: PipelineServices,
) -> None:
    publication_id = validated_from_values(
        pipeline_services, external_bid_id="database-activation-chronology"
    )
    with (
        pytest.raises(
            psycopg.errors.CheckViolation,
            match="publication_activation_chronology",
        ),
        pipeline_services.connection.transaction(),
        pipeline_services.connection.cursor() as cursor,
    ):
        cursor.execute(
            "update ingest.publication set status = 'published', activated_at = %s, "
            "published_count = normalized_count, canonical_fingerprint = %s, "
            "projector_version = %s where publication_id = %s",
            (VALIDATED_AT - timedelta(seconds=1), "0" * 64, BUILD_SHA, publication_id),
        )


def test_동일한_publication을_두_번_project해도_멱등하다(
    pipeline_services: PipelineServices,
) -> None:
    validated_publication = validated_from_values(
        pipeline_services, external_bid_id="repeat-projection"
    )
    first = project_publication(
        publication_id=validated_publication,
        projector_version=BUILD_SHA,
        activated_at=ACTIVATED_AT,
        repository=pipeline_services.projection_repository,
    )
    second = project_publication(
        publication_id=validated_publication,
        projector_version=BUILD_SHA,
        activated_at=ACTIVATED_AT + timedelta(hours=1),
        repository=pipeline_services.projection_repository,
    )

    assert first.canonical_fingerprint == second.canonical_fingerprint
    assert first.auction_revisions_inserted == 1
    assert second.auction_revisions_inserted == 0


def test_validated_terminal은_projection_전에_재검사할_수_있다(
    pipeline_services: PipelineServices,
) -> None:
    validated_publication = validated_from_values(
        pipeline_services, external_bid_id="validated-recheck"
    )
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            "select run_id from ingest.publication where publication_id = %s",
            (validated_publication,),
        )
        run_id = cursor.fetchone()[0]

    result = validate_run(
        run_id=run_id,
        publication_id=validated_publication,
        validated_at=VALIDATED_AT + timedelta(hours=1),
        repository=pipeline_services.publication_repository,
    )

    assert result.status == "validated"
    assert len(result.member_ids) == 1


def test_projection이_새_값_생성_없이_revision_범위_bigint_fact를_저장한다(
    pipeline_services: PipelineServices,
) -> None:
    publication_id = validated_from_values(
        pipeline_services,
        external_bid_id="projection-complete",
        organization_code="900001",
        sido_code="91",
        sigungu_code="9101",
        eligibility_code="91999",
    )

    result = project(pipeline_services, publication_id)

    assert result.members_projected == 1
    assert result.auction_attempts_inserted == 1
    assert result.auction_revisions_inserted == 1
    assert result.organizations_inserted == 1
    assert result.code_values_inserted == 4
    assert result.code_labels_inserted == 1
    assert result.relationships_inserted == 4
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            """
            select o.type, o.canonical_name, oi.observation_id,
                   ar.normalized_record_id, ao.role
            from core.organization o
            join core.organization_identifier oi using (organization_id)
            join core.auction_organization ao using (organization_id)
            join core.auction_revision ar using (auction_revision_id)
            join core.auction_attempt aa using (auction_attempt_id)
            where aa.external_bid_id = 'projection-complete'
            """
        )
        row = cursor.fetchone()
        assert row[0:2] == ("unknown", None)
        assert isinstance(row[2], int)
        assert isinstance(row[3], int)
        assert row[4] == "purchaser"
        cursor.execute(
            """
            select s.namespace, v.code, r.role,
                   pg_typeof(r.auction_revision_id)::text,
                   pg_typeof(r.code_value_id)::text
            from core.auction_revision_code_value r
            join core.code_value v using (code_value_id)
            join core.code_scheme s using (code_scheme_id)
            join core.auction_revision ar using (auction_revision_id)
            join core.auction_attempt aa using (auction_attempt_id)
            where aa.external_bid_id = 'projection-complete'
            order by s.namespace, v.code
            """
        )
        assert cursor.fetchall() == [
            ("eat:auction-location-sido", "91", "location_sido", "bigint", "bigint"),
            (
                "eat:auction-location-sigungu",
                "9101",
                "location_sigungu",
                "bigint",
                "bigint",
            ),
            ("eat:eligibility-area", "91999", "eligibility_area", "bigint", "bigint"),
        ]
        cursor.execute("select count(*) from core.code_mapping")
        assert cursor.fetchone() == (0,)
        cursor.execute(
            """
            select ar.announced_at, ar.deadline_at, ar.opened_at,
                   ar.base_amount, ar.planned_amount, ar.currency, ar.source_payload
            from core.auction_revision ar
            join core.auction_attempt aa using (auction_attempt_id)
            where aa.external_bid_id = 'projection-complete'
            """
        )
        revision = cursor.fetchone()
        assert revision[:6] == (
            datetime(2025, 6, 16, 15, 0, tzinfo=UTC),
            datetime(2025, 6, 19, 6, 0, tzinfo=UTC),
            datetime(2025, 6, 20, 1, 30, tzinfo=UTC),
            10000000,
            9990000,
            "KRW",
        )
        assert revision[6]["contractVersion"] == "eatbid.ingestion.auction.v1"
        assert revision[6]["identity"]["externalBidId"] == "projection-complete"
        cursor.execute(
            """
            select count(*) from core.code_value v
            join core.code_scheme s using (code_scheme_id)
            where s.namespace like 'mois:%' or s.namespace like 'neis:%'
            """
        )
        assert cursor.fetchone() == (0,)


def test_organization_code의_identity와_name은_observation_evidence이다(
    pipeline_services: PipelineServices,
) -> None:
    publications = [
        validated_from_values(
            pipeline_services,
            external_bid_id="org-a-first",
            organization_code="000100",
            organization_name="Same Name",
        ),
        validated_from_values(
            pipeline_services,
            external_bid_id="org-b",
            organization_code="000200",
            organization_name="Same Name",
        ),
        validated_from_values(
            pipeline_services,
            external_bid_id="org-a-later",
            organization_code="000100",
            organization_name="Renamed Source Label",
        ),
    ]
    for publication_id in publications:
        project(pipeline_services, publication_id)

    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            """
            select v.code, oi.organization_id
            from core.organization_identifier oi
            join core.code_value v using (code_value_id)
            where v.code in ('000100', '000200')
            order by v.code
            """
        )
        identifiers = cursor.fetchall()
        assert len(identifiers) == 2
        assert identifiers[0][1] != identifiers[1][1]
        cursor.execute(
            """
            select l.label, l.language
            from core.code_label_observation l
            join core.code_value v using (code_value_id)
            where v.code = '000100'
            order by l.label
            """
        )
        assert cursor.fetchall() == [
            ("Renamed Source Label", "und"),
            ("Same Name", "und"),
        ]


def test_누락된_display_number는_nullable_revision_data이다(
    pipeline_services: PipelineServices,
) -> None:
    publication_id = validated_from_values(
        pipeline_services,
        external_bid_id="no-display",
        display_bid_no=None,
    )
    project(pipeline_services, publication_id)

    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            """
            select ar.display_bid_no
            from core.auction_revision ar
            join core.auction_attempt aa using (auction_attempt_id)
            where aa.external_bid_id = 'no-display'
            """
        )
        assert cursor.fetchone() == (None,)


def test_v1_발행은_하한율과_공고_조건_코드_관계를_남기지_않는다(
    pipeline_services: PipelineServices,
) -> None:
    """v1 계약에는 `terms`가 없다. 없는 사실을 기본값으로 메우지 않는다(AGENTS 3)."""
    publication_id = validated_from_values(
        pipeline_services, external_bid_id="no-terms"
    )
    project(pipeline_services, publication_id)

    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            """
            select ar.floor_rate
            from core.auction_revision ar
            join core.auction_attempt aa using (auction_attempt_id)
            where aa.external_bid_id = 'no-terms'
            """
        )
        assert cursor.fetchone() == (None,)
        cursor.execute(
            """
            select count(*)
            from core.auction_revision_code_value rcv
            join core.auction_revision ar using (auction_revision_id)
            join core.auction_attempt aa using (auction_attempt_id)
            where aa.external_bid_id = 'no-terms'
              and rcv.role in ('award_method', 'planned_price_method')
            """
        )
        assert cursor.fetchone() == (0,)


def test_동시_projection이_직렬화되고_최초_metadata를_보존한다(
    pipeline_services: PipelineServices, migrated_db: MigratedDatabase
) -> None:
    publication_id = validated_from_values(
        pipeline_services, external_bid_id="concurrent-projection"
    )

    def invoke(offset: int):
        with migrated_db.connect() as connection:
            repository = PsycopgCanonicalProjectionRepository(
                connection, migrated_db.connect
            )
            return project_publication(
                publication_id=publication_id,
                projector_version=BUILD_SHA,
                activated_at=ACTIVATED_AT + timedelta(hours=offset),
                repository=repository,
            )

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(invoke, (0, 1)))

    assert sorted(result.auction_revisions_inserted for result in results) == [0, 1]
    assert results[0].canonical_fingerprint == results[1].canonical_fingerprint
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            "select activated_at, published_count from ingest.publication where publication_id = %s",
            (publication_id,),
        )
        activated_at, published_count = cursor.fetchone()
        assert activated_at in {ACTIVATED_AT, ACTIVATED_AT + timedelta(hours=1)}
        assert published_count == 1


def test_동시_publication이_organization_code_identity_하나를_재사용한다(
    pipeline_services: PipelineServices, migrated_db: MigratedDatabase
) -> None:
    publication_ids = (
        validated_from_values(
            pipeline_services,
            external_bid_id="shared-code-a",
            organization_code="777777",
            organization_name="First Label",
        ),
        validated_from_values(
            pipeline_services,
            external_bid_id="shared-code-b",
            organization_code="777777",
            organization_name="Second Label",
        ),
    )

    def invoke(publication_id: UUID):
        with migrated_db.connect() as connection:
            return project_publication(
                publication_id=publication_id,
                projector_version=BUILD_SHA,
                activated_at=ACTIVATED_AT,
                repository=PsycopgCanonicalProjectionRepository(
                    connection, migrated_db.connect
                ),
            )

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(invoke, publication_ids))

    assert sorted(result.organizations_inserted for result in results) == [0, 1]
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            """
            select count(distinct oi.organization_id), count(*)
            from core.organization_identifier oi
            join core.code_value v using (code_value_id)
            join core.code_scheme s using (code_scheme_id)
            where s.namespace = 'eat:organization' and v.code = '777777'
            """
        )
        assert cursor.fetchone() == (1, 1)
        cursor.execute(
            """
            select label from core.code_label_observation l
            join core.code_value v using (code_value_id)
            join core.code_scheme s using (code_scheme_id)
            where s.namespace = 'eat:organization' and v.code = '777777'
            order by label
            """
        )
        assert cursor.fetchall() == [("First Label",), ("Second Label",)]


def test_replay_publication이_동일한_normalized_revision을_재사용한다(
    pipeline_services: PipelineServices,
) -> None:
    original_publication = validated_from_values(
        pipeline_services, external_bid_id="replay-projection"
    )
    original = project(pipeline_services, original_publication)
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            """
            select p.run_id, pr.normalized_record_id, n.observation_id
            from ingest.publication p
            join ingest.publication_record pr using (publication_id)
            join ingest.normalized_record n using (normalized_record_id)
            where p.publication_id = %s
            """,
            (original_publication,),
        )
        _, normalized_record_id, observation_id = cursor.fetchone()
    pipeline_services.connection.commit()

    replay_run, replay_publication = start_replay_run(
        pipeline_services, (observation_id,)
    )
    replay_normalized = normalize_one(
        pipeline_services,
        observation_id,
        processing_run_id=replay_run,
    )
    assert replay_normalized.normalized_record_id == normalized_record_id
    validate_run(
        run_id=replay_run,
        publication_id=replay_publication,
        validated_at=VALIDATED_AT,
        repository=pipeline_services.publication_repository,
    )
    pipeline_services.connection.commit()

    replay = project(pipeline_services, replay_publication)

    assert original.auction_revisions_inserted == 1
    assert replay.auction_revisions_inserted == 0
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            "select status, published_count from ingest.publication where publication_id = %s",
            (replay_publication,),
        )
        assert cursor.fetchone() == ("published", 1)


def test_database_grain이_동일한_raw의_새_parser_interpretation을_허용한다(
    pipeline_services: PipelineServices,
) -> None:
    publication_id = validated_from_values(
        pipeline_services, external_bid_id="parser-grain"
    )
    project(pipeline_services, publication_id)
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            """
            select ar.auction_attempt_id, n.observation_id, n.source_entity_id,
                   n.normalized_payload, ar.observation_id, ar.content_sha256,
                   ar.display_bid_no, ar.source_status, ar.title, ar.announced_at,
                   ar.deadline_at, ar.opened_at, ar.base_amount, ar.planned_amount,
                   ar.currency, ar.source_payload
            from core.auction_revision ar
            join ingest.normalized_record n using (normalized_record_id)
            join core.auction_attempt aa using (auction_attempt_id)
            where aa.external_bid_id = 'parser-grain'
            """
        )
        row = cursor.fetchone()
        cursor.execute(
            """
            insert into ingest.normalized_record (
                observation_id, record_type, source_entity_id, normalized_payload,
                parser_version, normalized_at
            ) values (%s, 'auction.v1', %s, %s, 'eat-v2', %s)
            returning normalized_record_id
            """,
            (row[1], row[2], psycopg.types.json.Jsonb(row[3]), NORMALIZED_AT),
        )
        second_normalized_id = cursor.fetchone()[0]
        cursor.execute(
            """
            insert into core.auction_revision (
                auction_attempt_id, normalized_record_id, observation_id,
                content_sha256, display_bid_no, source_status, title,
                announced_at, deadline_at, opened_at, base_amount, planned_amount,
                currency, source_payload
            ) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                row[0],
                second_normalized_id,
                *row[4:15],
                psycopg.types.json.Jsonb(row[15]),
            ),
        )
    pipeline_services.connection.commit()

    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            """
            select count(*) from core.auction_revision ar
            join core.auction_attempt aa using (auction_attempt_id)
            where aa.external_bid_id = 'parser-grain'
            """
        )
        assert cursor.fetchone() == (2,)


def test_corrupt_payload가_rollback되고_projection을_계약_실패로_표시한다(
    pipeline_services: PipelineServices,
) -> None:
    publication_id = validated_from_values(
        pipeline_services, external_bid_id="corrupt-projection"
    )
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            """
            select p.run_id, p.validated_at, pr.normalized_record_id
            from ingest.publication p
            join ingest.publication_record pr using (publication_id)
            where p.publication_id = %s
            """,
            (publication_id,),
        )
        run_id, validated_at, member_id = cursor.fetchone()
        cursor.execute(
            """
            update ingest.normalized_record
            set normalized_payload = normalized_payload || '{"invented_school_type":"school"}'::jsonb
            where normalized_record_id = %s
            """,
            (member_id,),
        )
        cursor.execute("select count(*) from core.auction_attempt")
        attempts_before = cursor.fetchone()[0]
    pipeline_services.connection.commit()

    with pytest.raises(ProjectionContractError, match="normalized payload"):
        project(pipeline_services, publication_id)

    with pipeline_services.connection.cursor() as cursor:
        cursor.execute("select count(*) from core.auction_attempt")
        assert cursor.fetchone() == (attempts_before,)
        cursor.execute(
            """
            select p.status, p.validated_at, p.activated_at, p.published_count,
                   p.canonical_fingerprint, p.projector_version,
                   r.status, r.failure_category, r.ended_at
            from ingest.publication p join ingest.run r using (run_id)
            where p.publication_id = %s
            """,
            (publication_id,),
        )
        assert cursor.fetchone() == (
            "failed",
            validated_at,
            None,
            0,
            None,
            None,
            "failed",
            "PROJECTION_CONTRACT",
            ACTIVATED_AT,
        )
        cursor.execute(
            "select normalized_record_id from ingest.publication_record where publication_id = %s",
            (publication_id,),
        )
        assert cursor.fetchall() == [(member_id,)]

    rechecked = validate_run(
        run_id=run_id,
        publication_id=publication_id,
        validated_at=ACTIVATED_AT + timedelta(hours=1),
        repository=pipeline_services.publication_repository,
    )
    assert rechecked.status == "failed"
    assert rechecked.member_ids == (member_id,)


def test_누락된_reviewed_scheme가_contract_failure_표시_전에_rollback한다(
    pipeline_services: PipelineServices,
) -> None:
    publication_id = validated_from_values(
        pipeline_services,
        external_bid_id="missing-scheme-projection",
        organization_code="880001",
        sido_code="88",
        sigungu_code="8801",
        eligibility_code="88999",
    )
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute("select count(*) from core.auction_attempt")
        attempts_before = cursor.fetchone()[0]
        cursor.execute("select count(*) from core.organization")
        organizations_before = cursor.fetchone()[0]
        cursor.execute(
            """
            update core.code_scheme set namespace = 'disabled:eligibility-area'
            where namespace = 'eat:eligibility-area'
            """
        )
    pipeline_services.connection.commit()
    try:
        with pytest.raises(ProjectionContractError, match="reviewed code scheme"):
            project(pipeline_services, publication_id)
    finally:
        with pipeline_services.connection.cursor() as cursor:
            cursor.execute(
                """
                update core.code_scheme set namespace = 'eat:eligibility-area'
                where namespace = 'disabled:eligibility-area'
                """
            )
        pipeline_services.connection.commit()

    with pipeline_services.connection.cursor() as cursor:
        cursor.execute("select count(*) from core.auction_attempt")
        assert cursor.fetchone() == (attempts_before,)
        cursor.execute("select count(*) from core.organization")
        assert cursor.fetchone() == (organizations_before,)
        cursor.execute(
            """
            select p.status, r.failure_category
            from ingest.publication p join ingest.run r using (run_id)
            where p.publication_id = %s
            """,
            (publication_id,),
        )
        assert cursor.fetchone() == ("failed", "PROJECTION_CONTRACT")


def test_conflicting_existing_revision이_모든_새_projection_row를_rollback한다(
    pipeline_services: PipelineServices,
) -> None:
    publication_id = validated_from_values(
        pipeline_services,
        external_bid_id="conflicting-revision",
        organization_code="990001",
        sido_code="99",
        sigungu_code="9901",
        eligibility_code="99999",
    )
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            """
            select n.normalized_record_id, n.observation_id, n.source_entity_id,
                   o.content_sha256
            from ingest.publication_record pr
            join ingest.normalized_record n using (normalized_record_id)
            join ingest.raw_observation o using (observation_id)
            where pr.publication_id = %s
            """,
            (publication_id,),
        )
        normalized_record_id, observation_id, external_bid_id, content_sha256 = (
            cursor.fetchone()
        )
        cursor.execute(
            """
            insert into core.auction_attempt (source_system, external_bid_id)
            values ('eat', %s) returning auction_attempt_id
            """,
            (external_bid_id,),
        )
        attempt_id = cursor.fetchone()[0]
        cursor.execute(
            """
            insert into core.auction_revision (
                auction_attempt_id, normalized_record_id, observation_id,
                content_sha256, source_status, title, currency, source_payload
            ) values (%s, %s, %s, %s, 'tampered', 'tampered', 'KRW', '{}'::jsonb)
            """,
            (attempt_id, normalized_record_id, observation_id, content_sha256),
        )
        cursor.execute("select count(*) from core.organization")
        organizations_before = cursor.fetchone()[0]
        cursor.execute("select count(*) from core.code_value")
        code_values_before = cursor.fetchone()[0]
    pipeline_services.connection.commit()

    with pytest.raises(ProjectionContractError, match="persisted auction revision"):
        project(pipeline_services, publication_id)

    with pipeline_services.connection.cursor() as cursor:
        cursor.execute("select count(*) from core.organization")
        assert cursor.fetchone() == (organizations_before,)
        cursor.execute("select count(*) from core.code_value")
        assert cursor.fetchone() == (code_values_before,)
        cursor.execute(
            """
            select count(*) from core.auction_organization ao
            join core.auction_revision ar using (auction_revision_id)
            where ar.normalized_record_id = %s
            """,
            (normalized_record_id,),
        )
        assert cursor.fetchone() == (0,)


def test_publication_fingerprint가_수동_확인한_natural_payload_digest와_일치한다(
    pipeline_services: PipelineServices,
) -> None:
    publication_id = validated_from_values(
        pipeline_services, external_bid_id="fingerprint-fixed"
    )

    result = project(pipeline_services, publication_id)

    assert result.canonical_fingerprint == (
        "48d578345aa5f0ae5dd2f0916a31a7025bbc8229b2e1125151b013df837484b5"
    )
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            "select canonical_fingerprint from ingest.publication where publication_id = %s",
            (publication_id,),
        )
        assert cursor.fetchone() == (result.canonical_fingerprint,)


def test_일시적_repository_실패가_validated_publication을_재시도_가능하게_남긴다(
    pipeline_services: PipelineServices,
) -> None:
    publication_id = validated_from_values(
        pipeline_services, external_bid_id="transient-projection"
    )

    class TransientRepository:
        def project_publication(self, **_kwargs):
            raise psycopg.OperationalError("database unavailable")

    with pytest.raises(psycopg.OperationalError, match="database unavailable"):
        project_publication(
            publication_id=publication_id,
            projector_version=BUILD_SHA,
            activated_at=ACTIVATED_AT,
            repository=TransientRepository(),  # type: ignore[arg-type]
        )

    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            """
            select p.status, p.activated_at, p.canonical_fingerprint,
                   r.status, r.failure_category, r.ended_at
            from ingest.publication p join ingest.run r using (run_id)
            where p.publication_id = %s
            """,
            (publication_id,),
        )
        assert cursor.fetchone() == (
            "validated",
            None,
            None,
            "validated",
            None,
            None,
        )
