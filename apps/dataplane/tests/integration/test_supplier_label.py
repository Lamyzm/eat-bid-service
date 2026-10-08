"""업체명이 그 이름이 관측된 투찰 행에만 앉고 이름 관측 표에는 쌓이지 않는지 실제 PostgreSQL에서 확인한다
(EAT-314, ADR 0063)."""

from __future__ import annotations

from eatbid.pipeline.project import project_publication

from .conftest import PipelineServices
from .mart_support import fetch_all
from .test_normalize_validate import BUILD_SHA
from .test_project import ACTIVATED_AT
from .test_project_v2 import ROSTER_FIXTURE, ROSTER_ROWS, publish_v2_observation

# 비교 기준은 revision이 가리키는 정규화 기록이다. 같은 응답 같은 행의 `SHIPPER_NM` 원문이어야 한다.
_SUBMISSION_AND_RECORD = """
select submission.roster_ordinal, submission.supplier_label,
       record.normalized_payload
         #>> array['roster', 'submissions', submission.roster_ordinal::text,
                   'supplierAccount', 'accountCode', 'label']
  from core.bid_submission submission
  join core.auction_revision revision using (auction_revision_id)
  join ingest.normalized_record record on record.normalized_record_id = revision.normalized_record_id
 where submission.auction_revision_id = %s
 order by submission.roster_ordinal
"""

_SUPPLIER_LABEL_OBSERVATIONS = """
select count(*)
  from core.code_label_observation label
  join core.code_value value using (code_value_id)
  join core.code_scheme scheme using (code_scheme_id)
 where scheme.namespace = 'eat:supplier-account'
"""


def _publish(services: PipelineServices) -> int:
    publication_id, _ = publish_v2_observation(services, ROSTER_FIXTURE.read_bytes())
    project_publication(
        publication_id=publication_id,
        projector_version=BUILD_SHA,
        activated_at=ACTIVATED_AT,
        repository=services.projection_repository,
    )
    ((revision_id,),) = fetch_all(
        services, "select max(auction_revision_id) from core.auction_revision"
    )
    return int(revision_id)


def test_투찰_행의_업체명은_같은_관측_같은_행의_원문이다(
    pipeline_services: PipelineServices,
) -> None:
    rows = fetch_all(
        pipeline_services, _SUBMISSION_AND_RECORD, (_publish(pipeline_services),)
    )

    assert len(rows) == ROSTER_ROWS
    assert all(row[1] is not None for row in rows)
    assert [row[1] for row in rows] == [row[2] for row in rows]
    assert rows[0][1] == "비식별 업체 1"


def test_업체명은_이름_관측_표에_쌓이지_않는다(
    pipeline_services: PipelineServices,
) -> None:
    """관측 1건마다 명단 길이만큼 쌓이던 업체명 관측 행이 그 표의 93%였다(ADR 0063)."""
    _publish(pipeline_services)

    assert fetch_all(pipeline_services, _SUPPLIER_LABEL_OBSERVATIONS) == [(0,)]
