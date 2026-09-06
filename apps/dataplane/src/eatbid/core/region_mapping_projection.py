"""모듈 책임: 매핑 후보를 `core.code_mapping` 행으로 앉히고 만들지 못한 코드 수를 보고한다.

판정 규칙(`region_mapping.py`)과 나눈 이유는 규칙이 질의 없이 검증되어야 하기 때문이다. 여기는
어느 라벨을 읽고 어느 근거·유효기간으로 행을 만드는지만 소유한다.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import psycopg

from eatbid.core.region_mapping import (
    REVIEWED_STATUS,
    RegionMappingCandidate,
    RegionMappingProposal,
    propose_region_mappings,
)
from eatbid.core.repository import ProjectionContractError


@dataclass(frozen=True, slots=True)
class RegionMappingResult:
    from_scheme: str
    observed_code_count: int
    created_count: int
    already_present_count: int
    ambiguous_count: int
    unmatched_count: int
    without_label_count: int

    @property
    def mapped_count(self) -> int:
        return self.created_count + self.already_present_count


def project_region_mappings(
    cursor: psycopg.Cursor[Any],
    *,
    from_scheme: str,
    code_release_id: int,
    observation_id: int,
    valid_from: datetime,
) -> RegionMappingResult:
    """관측된 eaT 코드를 활성 release의 행안부 코드에 결정적 일치로만 잇는다.

    `valid_from`은 우리가 지어낸 경계가 아니라 **이 release가 말한 구역에 대해 이 대응을 주장한다**는
    관측 사실이다. `code_mapping`의 경계 check도 이것으로 충족된다(ADR 0035 결정 6).
    """
    source_labels = _labels_for_scheme(cursor, from_scheme)
    target_labels = _labels_for_release(cursor, code_release_id)
    if not target_labels:
        raise ProjectionContractError("code release has no labelled members to map onto")
    proposal = propose_region_mappings(
        source_labels=source_labels, target_labels=target_labels
    )
    created, present = _insert_candidates(
        cursor,
        proposal.candidates,
        observation_id=observation_id,
        valid_from=valid_from,
    )
    return RegionMappingResult(
        from_scheme=from_scheme,
        observed_code_count=len(source_labels),
        created_count=created,
        already_present_count=present,
        ambiguous_count=len(proposal.ambiguous_source_code_value_ids),
        unmatched_count=len(proposal.unmatched_source_code_value_ids),
        without_label_count=len(proposal.source_code_value_ids_without_label),
    )


def build_region_mapping_proposal(
    cursor: psycopg.Cursor[Any], *, from_scheme: str, code_release_id: int
) -> RegionMappingProposal:
    """행을 만들지 않고 후보만 본다. 사람이 검토해야 하는 목록을 뽑는 자리다."""
    return propose_region_mappings(
        source_labels=_labels_for_scheme(cursor, from_scheme),
        target_labels=_labels_for_release(cursor, code_release_id),
    )


def record_reviewed_mapping(
    cursor: psycopg.Cursor[Any],
    *,
    from_code_value_id: int,
    to_code_value_id: int,
    relation: str,
    valid_from: datetime,
    observation_id: int,
) -> bool:
    """사람이 승인한 매핑 한 행을 남긴다. 새로 만들었으면 True다.

    자동 경로와 함수를 나눈 이유: `overlaps`는 한 코드가 두 구역에 걸쳐 있다는 사실이고 어떤 라벨
    일치로도 도출되지 않는다. 자동 생성이 이 관계를 만들 수 있으면 "사람이 만든다"가 규칙이 아니라
    관습이 된다(ADR 0035 결정 6). eaT `SIDO_CD=18`이 정확히 이 부류다 — 원본이 전라남도와 광주광역시를
    같은 코드로 주고 우리에게 나눌 근거가 없다.
    """
    created, _present = _insert_candidates(
        cursor,
        (
            RegionMappingCandidate(
                from_code_value_id=from_code_value_id,
                to_code_value_id=to_code_value_id,
                relation=relation,
                status=REVIEWED_STATUS,
            ),
        ),
        observation_id=observation_id,
        valid_from=valid_from,
    )
    return created == 1


def _labels_for_scheme(
    cursor: psycopg.Cursor[Any], namespace: str
) -> dict[int, list[str]]:
    """관측된 코드 전부를 돌려준다. 라벨이 없는 코드도 빈 목록으로 남겨야 미매핑 이유가 갈린다."""
    cursor.execute(
        """
        select v.code_value_id, o.label
        from core.code_value v
        join core.code_scheme s using (code_scheme_id)
        left join core.code_label_observation o on o.code_value_id = v.code_value_id
        where s.namespace = %s
        """,
        (namespace,),
    )
    labels: dict[int, list[str]] = {}
    for code_value_id, label in cursor.fetchall():
        entry = labels.setdefault(int(code_value_id), [])
        if label is not None:
            entry.append(str(label))
    return labels


def _labels_for_release(
    cursor: psycopg.Cursor[Any], code_release_id: int
) -> dict[int, list[str]]:
    cursor.execute(
        """
        select m.code_value_id, o.label
        from core.code_release_member m
        join core.code_label_observation o on o.code_value_id = m.code_value_id
        where m.code_release_id = %s and m.active
        """,
        (code_release_id,),
    )
    labels: dict[int, list[str]] = {}
    for code_value_id, label in cursor.fetchall():
        labels.setdefault(int(code_value_id), []).append(str(label))
    return labels


def _insert_candidates(
    cursor: psycopg.Cursor[Any],
    candidates: Sequence[RegionMappingCandidate],
    *,
    observation_id: int,
    valid_from: datetime,
) -> tuple[int, int]:
    created = 0
    present = 0
    for candidate in candidates:
        cursor.execute(
            """
            select code_mapping_id from core.code_mapping
            where from_code_value_id = %s and to_code_value_id = %s
              and relation = %s and valid_from = %s
            """,
            (
                candidate.from_code_value_id,
                candidate.to_code_value_id,
                candidate.relation,
                valid_from,
            ),
        )
        if cursor.fetchone() is not None:
            present += 1
            continue
        cursor.execute(
            """
            insert into core.code_mapping (
                from_code_value_id, to_code_value_id, relation, valid_from,
                evidence_observation_id, status
            ) values (%s, %s, %s, %s, %s, %s)
            """,
            (
                candidate.from_code_value_id,
                candidate.to_code_value_id,
                candidate.relation,
                valid_from,
                observation_id,
                candidate.status,
            ),
        )
        created += 1
    return created, present
