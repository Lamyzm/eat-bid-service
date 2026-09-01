from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID, uuid4

import psycopg
import pytest

from eatbid.ingest.models import CaptureRequest
from eatbid.ingest.postgres_release_repository import (
    PsycopgSourceReleaseRepository,
)
from eatbid.ingest.release_models import (
    ReleaseDatasetPlan,
    ReleaseDatasetProgress,
    SourceReleasePlan,
)
from eatbid.ingest.release_repository import (
    ReleaseIncompleteError,
    ReleaseIsolationContractError,
    ReleaseManifestConflictError,
    ReleaseMissingMemberError,
    ReleasePlanConflictError,
    ReleaseProgressError,
    ReleaseSealedError,
    ReleaseSourceMismatchError,
    release_manifest_sha256,
)
from eatbid.source.client import SourceResponse

from .conftest import MigratedDatabase, PipelineServices

BUILD_SHA = "1" * 64
SCHEMA_FINGERPRINT = "2" * 64
STARTED_AT = datetime(2026, 9, 1, 1, tzinfo=UTC)
FETCHED_AT = datetime(2026, 9, 1, 1, 1, tzinfo=UTC)
AS_OF = datetime(2026, 9, 1, 3, tzinfo=UTC)
SEALED_AT = datetime(2026, 9, 1, 3, 1, tzinfo=UTC)


def _capture(
    services: PipelineServices, *, suffix: str, source: str = "eat"
) -> tuple[UUID, int, str]:
    run_id = uuid4()
    services.repository.start_run(
        run_id=run_id,
        mode="poll-open",
        build_sha=BUILD_SHA,
        parser_version="eat-v1",
        started_at=STARTED_AT,
        expected_count=1,
    )
    planned = services.repository.plan_request_unit(
        run_id=run_id,
        source=source,
        endpoint="bid-list",
        params={"page": suffix},
        expected_count=1,
    )
    body = f"<result>{suffix}</result>".encode()
    stored = services.store.put(source=source, endpoint="bid-list", body=body)
    observation = services.repository.record_observation(
        request=CaptureRequest(
            request_unit_id=planned.request_unit_id,
            run_id=run_id,
            source=source,
            endpoint="bid-list",
            params=planned.params,
        ),
        response=SourceResponse(200, body, FETCHED_AT),
        stored=stored,
        failure_category=None,
    )
    return run_id, observation.observation_id, observation.content_sha256


def _dataset(
    *, expected: int = 1, observed: int = 1, normalized: int = 1
) -> ReleaseDatasetPlan:
    return ReleaseDatasetPlan(
        endpoint="bid-list",
        dataset="auction",
        record_type="auction",
        parser_version="eat-v1",
        schema_fingerprint=SCHEMA_FINGERPRINT,
        expected_count=expected,
        observed_count=observed,
        normalized_count=normalized,
        quarantined_count=0,
        required=True,
    )


def _plan(
    dataset: ReleaseDatasetPlan,
    *,
    source_release_id: UUID | None = None,
    release_name: str | None = None,
) -> SourceReleasePlan:
    release_id = source_release_id or uuid4()
    return SourceReleasePlan(
        source_release_id=release_id,
        source="eat",
        release_name=release_name or f"release-{release_id}",
        as_of=AS_OF,
        datasets=(dataset,),
    )


def _prepared_release(
    services: PipelineServices,
    *,
    suffix: str,
    dataset: ReleaseDatasetPlan | None = None,
) -> tuple[PsycopgSourceReleaseRepository, SourceReleasePlan, int, str]:
    run_id, observation_id, content_sha256 = _capture(services, suffix=suffix)
    repository = PsycopgSourceReleaseRepository(services.connection)
    plan = _plan(dataset or _dataset())
    repository.plan_release(plan)
    repository.attach_run(plan.source_release_id, run_id)
    repository.attach_observation(plan.source_release_id, observation_id)
    return repository, plan, observation_id, content_sha256


def test_필수_dataset이_불완전하면_release를_봉인하지_않는다(
    pipeline_services: PipelineServices,
) -> None:
    repository, plan, _, _ = _prepared_release(
        pipeline_services,
        suffix="incomplete",
        dataset=_dataset(expected=2, observed=1, normalized=1),
    )

    with pytest.raises(ReleaseIncompleteError):
        repository.seal_release(plan.source_release_id, sealed_at=SEALED_AT)

    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            "select status, manifest_sha256, sealed_at from ingest.source_release "
            "where source_release_id = %s",
            (plan.source_release_id,),
        )
        assert cursor.fetchone() == ("planned", None, None)


def test_dataset_progress는_expected_contract를_보존하며_단조_증가한다(
    pipeline_services: PipelineServices,
) -> None:
    repository, plan, _, _ = _prepared_release(
        pipeline_services,
        suffix="progress",
        dataset=_dataset(expected=2, observed=0, normalized=0),
    )
    repository.record_dataset_progress(
        plan.source_release_id,
        ReleaseDatasetProgress(
            dataset="auction",
            observed_count=1,
            normalized_count=1,
            quarantined_count=0,
        ),
    )

    [progress] = repository.completeness(plan.source_release_id)
    assert progress.expected_count == 2
    assert progress.observed_count == 1
    assert not progress.is_complete

    with pytest.raises(ReleaseProgressError, match="monotonic"):
        repository.record_dataset_progress(
            plan.source_release_id,
            ReleaseDatasetProgress(
                dataset="auction",
                observed_count=0,
                normalized_count=0,
                quarantined_count=0,
            ),
        )


def test_seal은_DB_content_hash로_manifest를_만든다(
    pipeline_services: PipelineServices,
) -> None:
    repository, plan, observation_id, content_sha256 = _prepared_release(
        pipeline_services,
        suffix="manifest",
    )

    sealed = repository.seal_release(plan.source_release_id, sealed_at=SEALED_AT)

    assert sealed.manifest_sha256 == release_manifest_sha256(
        plan, ((observation_id, content_sha256),)
    )


def test_sealed_release의_모든_membership과_progress는_불변이다(
    pipeline_services: PipelineServices,
) -> None:
    repository, plan, _, _ = _prepared_release(pipeline_services, suffix="sealed")
    other_run_id, other_observation_id, _ = _capture(
        pipeline_services, suffix="sealed-other"
    )
    repository.seal_release(plan.source_release_id, sealed_at=SEALED_AT)

    operations = (
        lambda: repository.attach_run(plan.source_release_id, other_run_id),
        lambda: repository.attach_observation(
            plan.source_release_id, other_observation_id
        ),
        lambda: repository.record_dataset_progress(
            plan.source_release_id,
            ReleaseDatasetProgress(
                dataset="auction",
                observed_count=1,
                normalized_count=1,
                quarantined_count=0,
            ),
        ),
    )
    for operation in operations:
        with pytest.raises(ReleaseSealedError):
            operation()


def test_failed_release의_progress도_typed_terminal_error로_거부된다(
    pipeline_services: PipelineServices,
) -> None:
    repository, plan, _, _ = _prepared_release(pipeline_services, suffix="failed")
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            "update ingest.source_release set status = 'failed', "
            "failure_category = 'SOURCE_CONTRACT' where source_release_id = %s",
            (plan.source_release_id,),
        )
    pipeline_services.connection.commit()

    with pytest.raises(ReleaseSealedError):
        repository.record_dataset_progress(
            plan.source_release_id,
            ReleaseDatasetProgress(
                dataset="auction",
                observed_count=1,
                normalized_count=1,
                quarantined_count=0,
            ),
        )


def test_같은_source_manifest는_typed_conflict로_보존된다(
    pipeline_services: PipelineServices,
) -> None:
    repository, first_plan, observation_id, _ = _prepared_release(
        pipeline_services, suffix="manifest-conflict"
    )
    repository.seal_release(first_plan.source_release_id, sealed_at=SEALED_AT)
    second_plan = _plan(_dataset(), release_name="동일 manifest의 두 번째 release")
    repository.plan_release(second_plan)
    repository.attach_observation(second_plan.source_release_id, observation_id)

    with pytest.raises(ReleaseManifestConflictError):
        repository.seal_release(second_plan.source_release_id, sealed_at=SEALED_AT)


def test_seal은_ambient_transaction을_typed_25000으로_거부한다(
    pipeline_services: PipelineServices,
) -> None:
    repository, plan, _, _ = _prepared_release(pipeline_services, suffix="ambient")
    pipeline_services.connection.execute("select 1")

    with pytest.raises(ReleaseIsolationContractError) as caught:
        repository.seal_release(plan.source_release_id, sealed_at=SEALED_AT)

    assert caught.value.sqlstate == "25000"
    pipeline_services.connection.rollback()


def test_seal은_session_default와_무관하게_READ_COMMITTED를_명시한다(
    pipeline_services: PipelineServices, migrated_db: MigratedDatabase
) -> None:
    _, plan, _, _ = _prepared_release(pipeline_services, suffix="read-committed")
    with migrated_db.connect() as connection:
        connection.execute("set default_transaction_isolation = 'serializable'")
        connection.commit()
        repository = PsycopgSourceReleaseRepository(connection)

        sealed = repository.seal_release(
            plan.source_release_id, sealed_at=SEALED_AT
        )

    assert sealed.source_release_id == plan.source_release_id


def test_seal은_명시된_SERIALIZABLE_connection을_typed_error로_거부한다(
    pipeline_services: PipelineServices, migrated_db: MigratedDatabase
) -> None:
    _, plan, _, _ = _prepared_release(pipeline_services, suffix="serializable")
    with migrated_db.connect() as connection:
        connection.isolation_level = psycopg.IsolationLevel.SERIALIZABLE
        repository = PsycopgSourceReleaseRepository(connection)

        with pytest.raises(ReleaseIsolationContractError) as caught:
            repository.seal_release(plan.source_release_id, sealed_at=SEALED_AT)

    assert caught.value.sqlstate == "25000"


def test_DB_SQLSTATE_25000은_typed_isolation_error의_cause로_보존된다(
    pipeline_services: PipelineServices,
) -> None:
    repository, plan, _, _ = _prepared_release(pipeline_services, suffix="sqlstate")
    function_name = f"force_release_25000_{uuid4().hex}"
    trigger_name = function_name
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            f"""
            create function public.{function_name}() returns trigger
            language plpgsql as $$
            begin
                raise exception 'forced isolation contract failure'
                    using errcode = 'invalid_transaction_state';
            end
            $$
            """
        )
        cursor.execute(
            f"""
            create trigger {trigger_name}
            before update on ingest.source_release
            for each row execute function public.{function_name}()
            """
        )
    pipeline_services.connection.commit()
    try:
        with pytest.raises(ReleaseIsolationContractError) as caught:
            repository.seal_release(plan.source_release_id, sealed_at=SEALED_AT)
        assert caught.value.sqlstate == "25000"
        assert isinstance(caught.value.__cause__, psycopg.Error)
        assert caught.value.__cause__.sqlstate == "25000"
    finally:
        with pipeline_services.connection.cursor() as cursor:
            cursor.execute(
                f"drop trigger if exists {trigger_name} on ingest.source_release"
            )
            cursor.execute(f"drop function if exists public.{function_name}()")
        pipeline_services.connection.commit()


def test_cross_source_observation은_attach에서_typed_mismatch로_거부된다(
    pipeline_services: PipelineServices,
) -> None:
    _, observation_id, _ = _capture(
        pipeline_services, suffix="cross-source-attach", source="other"
    )
    repository = PsycopgSourceReleaseRepository(pipeline_services.connection)
    plan = _plan(_dataset())
    repository.plan_release(plan)

    with pytest.raises(ReleaseSourceMismatchError) as caught:
        repository.attach_observation(plan.source_release_id, observation_id)

    assert caught.value.release_source == "eat"
    assert caught.value.observation_source == "other"
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            "select count(*) from ingest.source_release_observation "
            "where source_release_id = %s",
            (plan.source_release_id,),
        )
        assert cursor.fetchone() == (0,)


def test_direct_SQL_cross_source_membership은_seal에서_rollback된다(
    pipeline_services: PipelineServices,
) -> None:
    _, observation_id, _ = _capture(
        pipeline_services, suffix="cross-source-seal", source="other"
    )
    repository = PsycopgSourceReleaseRepository(pipeline_services.connection)
    plan = _plan(_dataset())
    repository.plan_release(plan)
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            "insert into ingest.source_release_observation "
            "(source_release_id, observation_id) values (%s, %s)",
            (plan.source_release_id, observation_id),
        )
    pipeline_services.connection.commit()

    with pytest.raises(ReleaseSourceMismatchError):
        repository.seal_release(plan.source_release_id, sealed_at=SEALED_AT)

    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            "select status, manifest_sha256, sealed_at from ingest.source_release "
            "where source_release_id = %s",
            (plan.source_release_id,),
        )
        assert cursor.fetchone() == ("planned", None, None)


@pytest.mark.parametrize(
    ("member_kind", "attach"),
    [
        ("run", lambda repository, release_id: repository.attach_run(release_id, uuid4())),
        (
            "observation",
            lambda repository, release_id: repository.attach_observation(
                release_id, 2**62
            ),
        ),
    ],
)
def test_없는_member_FK는_kind가_있는_typed_error로_보존된다(
    pipeline_services: PipelineServices,
    member_kind: str,
    attach,
) -> None:
    repository = PsycopgSourceReleaseRepository(pipeline_services.connection)
    plan = _plan(_dataset())
    repository.plan_release(plan)

    with pytest.raises(ReleaseMissingMemberError) as caught:
        attach(repository, plan.source_release_id)

    assert caught.value.member_kind == member_kind
    assert isinstance(caught.value.__cause__, psycopg.errors.ForeignKeyViolation)


def test_같은_release_UUID는_plan_identity_conflict로_보존된다(
    pipeline_services: PipelineServices,
) -> None:
    repository = PsycopgSourceReleaseRepository(pipeline_services.connection)
    plan = _plan(_dataset())
    repository.plan_release(plan)
    conflicting = _plan(
        _dataset(),
        source_release_id=plan.source_release_id,
        release_name="다른 이름",
    )

    with pytest.raises(ReleasePlanConflictError) as caught:
        repository.plan_release(conflicting)

    assert caught.value.conflict_kind == "source_release_id"
    assert isinstance(caught.value.__cause__, psycopg.errors.UniqueViolation)


def test_같은_source_release_name은_plan_name_conflict로_보존된다(
    pipeline_services: PipelineServices,
) -> None:
    repository = PsycopgSourceReleaseRepository(pipeline_services.connection)
    release_name = "중복 이름"
    repository.plan_release(_plan(_dataset(), release_name=release_name))

    with pytest.raises(ReleasePlanConflictError) as caught:
        repository.plan_release(_plan(_dataset(), release_name=release_name))

    assert caught.value.conflict_kind == "source_release_name"
    assert isinstance(caught.value.__cause__, psycopg.errors.UniqueViolation)
