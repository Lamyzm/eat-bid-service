"""모듈 책임: 정규화된 정부 코드 release를 `core.code_release`·`code_release_member`·`code_value`·
`code_label_observation`으로 앉히고 같은 release를 두 번 투영해도 행이 늘지 않게 한다.

`postgres_code_values.py`의 해소 규칙을 재사용하는 이유는 코드와 라벨을 앉히는 fail-closed 규칙이
공고 투영과 여기서 갈리면 안 되기 때문이다.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import UUID

import psycopg

from eatbid.core.postgres_code_values import resolve_code_value, resolve_label
from eatbid.core.repository import ProjectionContractError
from eatbid.generated.code_release_v1 import EatbidCodeReleaseV1
from eatbid.source.reference.mois_parser import member_grain


@dataclass(frozen=True, slots=True)
class CodeReleaseProjectionResult:
    """한 번의 투영이 실제로 만든 것과, 만들지 못한 계층을 함께 보고한다."""

    code_release_id: int
    member_count: int
    inserted_code_values: int
    inserted_labels: int
    members_without_parent: int
    already_projected: bool


def project_code_release(
    cursor: psycopg.Cursor[Any],
    release: EatbidCodeReleaseV1,
    *,
    source_release_id: UUID,
    observation_id: int,
    observed_at: datetime,
) -> CodeReleaseProjectionResult:
    """봉인된 원본 하나가 만든 코드 한 벌을 core에 앉힌다.

    이미 같은 (source_release, scheme)로 투영된 release가 있으면 아무것도 바꾸지 않는다. 정정 파일은
    새 release이며 기존 member를 수정하지 않는다는 규칙을 여기서 지킨다(ADR 0035).
    """
    _require_sealed_release(cursor, source_release_id)
    scheme_id = _require_scheme(cursor, release.scheme)
    existing = _existing_release(cursor, source_release_id, scheme_id)
    if existing is not None:
        code_release_id, member_count = existing
        if member_count != len(release.members):
            raise ProjectionContractError(
                "code release membership conflicts with the sealed release"
            )
        return CodeReleaseProjectionResult(
            code_release_id=code_release_id,
            member_count=member_count,
            inserted_code_values=0,
            inserted_labels=0,
            members_without_parent=_members_without_parent(cursor, code_release_id),
            already_projected=True,
        )

    code_release_id = _insert_release(
        cursor, release, source_release_id=source_release_id, scheme_id=scheme_id
    )
    inserted_code_values = 0
    inserted_labels = 0
    code_value_ids: dict[str, int] = {}
    for member in release.members:
        code_value_id, code_inserted = resolve_code_value(
            cursor, namespace=release.scheme, code=member.code, allow_insert=True
        )
        inserted_code_values += code_inserted
        inserted_labels += resolve_label(
            cursor,
            code_value_id=code_value_id,
            label=member.label,
            observation_id=observation_id,
            observed_at=observed_at,
            allow_insert=True,
        )
        code_value_ids[member.code] = code_value_id

    # 상위 없는 member를 먼저 앉힌다. 복합 FK가 같은 release 안의 행만 상위로 받으므로 부모가 아직
    # 없는 순간에 자식을 넣으면 정렬 순서에 따라 성공과 실패가 갈린다.
    members_without_parent = 0
    ordered = sorted(
        release.members,
        key=lambda member: (member.parent_code is not None, member.code),
    )
    for member in ordered:
        parent_code = None if member.parent_code is None else member.parent_code.root
        parent_id = None if parent_code is None else code_value_ids.get(parent_code)
        if parent_id is None:
            members_without_parent += 1
        cursor.execute(
            """
            insert into core.code_release_member (
                code_release_id, code_value_id, parent_code_value_id, grain,
                active, valid_from, valid_to
            ) values (%s, %s, %s, %s, %s, %s, %s)
            """,
            (
                code_release_id,
                code_value_ids[member.code],
                parent_id,
                member_grain(member),
                member.active,
                None if member.valid_from is None else member.valid_from.root,
                None if member.valid_to is None else member.valid_to.root,
            ),
        )
    return CodeReleaseProjectionResult(
        code_release_id=code_release_id,
        member_count=len(release.members),
        inserted_code_values=inserted_code_values,
        inserted_labels=inserted_labels,
        members_without_parent=members_without_parent,
        already_projected=False,
    )


def _require_sealed_release(cursor: psycopg.Cursor[Any], source_release_id: UUID) -> None:
    """봉인되지 않은 입력으로 canonical 행을 공개하지 않는다(AGENTS 변경 절차)."""
    cursor.execute(
        "select status from ingest.source_release where source_release_id = %s",
        (str(source_release_id),),
    )
    row = cursor.fetchone()
    if row is None:
        raise ProjectionContractError("source release is missing")
    if row[0] != "sealed":
        raise ProjectionContractError("source release is not sealed")


def _require_scheme(cursor: psycopg.Cursor[Any], namespace: str) -> int:
    cursor.execute(
        "select code_scheme_id from core.code_scheme where namespace = %s",
        (namespace,),
    )
    row = cursor.fetchone()
    if row is None:
        raise ProjectionContractError(f"reviewed code scheme is missing: {namespace}")
    return int(row[0])


def _existing_release(
    cursor: psycopg.Cursor[Any], source_release_id: UUID, scheme_id: int
) -> tuple[int, int] | None:
    cursor.execute(
        """
        select code_release_id, member_count from core.code_release
        where source_release_id = %s and code_scheme_id = %s
        for update
        """,
        (str(source_release_id), scheme_id),
    )
    row = cursor.fetchone()
    return None if row is None else (int(row[0]), int(row[1]))


def _insert_release(
    cursor: psycopg.Cursor[Any],
    release: EatbidCodeReleaseV1,
    *,
    source_release_id: UUID,
    scheme_id: int,
) -> int:
    cursor.execute(
        """
        insert into core.code_release (
            source_release_id, code_scheme_id, source_version, published_at,
            promoted_grain, source_row_count, member_count, excluded_row_count
        ) values (%s, %s, %s, %s, %s, %s, %s, %s)
        returning code_release_id
        """,
        (
            str(source_release_id),
            scheme_id,
            release.source_version,
            None if release.published_at is None else release.published_at.root,
            [grain.root for grain in release.promoted_grain],
            release.source_row_count,
            len(release.members),
            release.excluded_row_count,
        ),
    )
    row = cursor.fetchone()
    if row is None:
        raise ProjectionContractError("code release could not be created")
    return int(row[0])


def _members_without_parent(cursor: psycopg.Cursor[Any], code_release_id: int) -> int:
    cursor.execute(
        """
        select count(*) from core.code_release_member
        where code_release_id = %s and parent_code_value_id is null
        """,
        (code_release_id,),
    )
    row = cursor.fetchone()
    return 0 if row is None else int(row[0])
