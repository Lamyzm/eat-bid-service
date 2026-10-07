"""revision의 열 넷이 그 revision을 낳은 정규화 기록의 값과 같은지 실제 PostgreSQL에서 확인한다(EAT-308).

revision은 정규화 기록의 jsonb 사본을 더는 들지 않는다. 비교 기준은 `normalized_record_id`가 가리키는
`ingest.normalized_record.normalized_payload`이며, 식은 사본이 있던 동안 읽는 쪽이 쓰던 식과 같다.
"""

from __future__ import annotations

from eatbid.pipeline.project import project_publication

from .conftest import PipelineServices
from .mart_support import fetch_all
from .test_normalize_validate import BUILD_SHA
from .test_project import ACTIVATED_AT, project, validated_from_values
from .test_project_v2 import ROSTER_FIXTURE, ROSTER_ROWS, publish_v2_observation

_COLUMNS_AND_RECORD = """
select revision.roster_submission_count, revision.source_roster_size,
       revision.source_category_label, revision.lineage_observed,
       case when jsonb_typeof(record.normalized_payload #> '{roster,submissions}') = 'array'
            then jsonb_array_length(record.normalized_payload #> '{roster,submissions}') end,
       (record.normalized_payload #>> '{roster,sourceRosterSize}')::integer,
       record.normalized_payload #>> '{classification,sourceCategoryLabel}',
       record.normalized_payload ? 'lineage'
  from core.auction_revision revision
  join ingest.normalized_record record using (normalized_record_id)
 where revision.auction_revision_id = %s
"""


def _latest_revision(services: PipelineServices) -> int:
    ((revision_id,),) = fetch_all(
        services, "select max(auction_revision_id) from core.auction_revision"
    )
    return int(revision_id)


def test_v2_revision의_열은_정규화_기록의_명단_품목_사슬_값과_같다(
    pipeline_services: PipelineServices,
) -> None:
    publication_id, _ = publish_v2_observation(
        pipeline_services, ROSTER_FIXTURE.read_bytes()
    )
    project_publication(
        publication_id=publication_id,
        projector_version=BUILD_SHA,
        activated_at=ACTIVATED_AT,
        repository=pipeline_services.projection_repository,
    )

    (row,) = fetch_all(
        pipeline_services, _COLUMNS_AND_RECORD, (_latest_revision(pipeline_services),)
    )

    assert row[:4] == row[4:]
    assert row[0] == ROSTER_ROWS
    assert row[3] is True


def test_v1_revision은_명단_줄_수가_null이고_사슬은_모름이다(
    pipeline_services: PipelineServices,
) -> None:
    """v1 계약에는 명단·사슬 블록이 없다. 0이나 "사슬 없음"으로 메우면 모르는 것을 아는 척하게 된다."""
    project(
        pipeline_services,
        validated_from_values(pipeline_services, external_bid_id="revision-columns-v1"),
    )

    (row,) = fetch_all(
        pipeline_services, _COLUMNS_AND_RECORD, (_latest_revision(pipeline_services),)
    )

    assert row[:4] == row[4:]
    assert row[0] is None
    assert row[3] is False
