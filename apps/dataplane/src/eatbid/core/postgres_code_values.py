"""모듈 책임: 관측된 외부 코드와 그 라벨을 `core.code_value`·`core.code_label_observation`에
insert-or-verify로 앉히고 내부 id를 돌려준다.

공고 투영·명단 투영·사슬 투영이 모두 같은 해소 규칙을 쓰므로 한 곳에 둔다. 세 writer가 각자 SQL을
적으면 "발행된 코드가 없으면 실패한다"는 fail-closed 규칙이 셋 중 하나에서만 조용히 빠질 수 있다.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

import psycopg

from eatbid.core.projection_models import CodeObservation
from eatbid.core.repository import ProjectionContractError


def resolve_code_value(
    cursor: psycopg.Cursor[Any],
    *,
    namespace: str,
    code: str,
    allow_insert: bool,
) -> tuple[int, int]:
    """code value의 내부 id와 이번에 새로 넣었는지를 돌려준다.

    scheme이 없으면 실패다. 검토되지 않은 scheme을 여기서 만들어 주면 시드가 소유하는 등록 목록이
    투영 경로에서 조용히 넓어진다(ADR 0006).
    """
    cursor.execute(
        "select code_scheme_id from core.code_scheme where namespace = %s",
        (namespace,),
    )
    scheme = cursor.fetchone()
    if scheme is None:
        raise ProjectionContractError(f"reviewed code scheme is missing: {namespace}")
    scheme_id = int(scheme[0])
    if allow_insert:
        cursor.execute(
            """
            insert into core.code_value (code_scheme_id, code)
            values (%s, %s)
            on conflict (code_scheme_id, code) do nothing
            returning code_value_id
            """,
            (scheme_id, code),
        )
        inserted = cursor.fetchone()
        if inserted is not None:
            return int(inserted[0]), 1
    cursor.execute(
        """
        select code_value_id from core.code_value
        where code_scheme_id = %s and code = %s for update
        """,
        (scheme_id, code),
    )
    existing = cursor.fetchone()
    if existing is None:
        raise ProjectionContractError(
            f"published code value is missing: {namespace}/{code}"
        )
    return int(existing[0]), 0


def resolve_label(
    cursor: psycopg.Cursor[Any],
    *,
    code_value_id: int,
    label: str,
    observation_id: int,
    observed_at: datetime,
    allow_insert: bool,
) -> int:
    """라벨을 관측 증거로 남긴다. 같은 증거에 다른 시각이 붙으면 계약 위반이다."""
    if allow_insert:
        cursor.execute(
            """
            insert into core.code_label_observation (
                code_value_id, label, language, observed_at, observation_id
            ) values (%s, %s, 'und', %s, %s)
            on conflict (code_value_id, label, language, observation_id) do nothing
            returning code_label_observation_id
            """,
            (code_value_id, label, observed_at, observation_id),
        )
        inserted = cursor.fetchone()
        if inserted is not None:
            return 1
    cursor.execute(
        """
        select observed_at from core.code_label_observation
        where code_value_id = %s and label = %s and language = 'und'
          and observation_id = %s
        for update
        """,
        (code_value_id, label, observation_id),
    )
    existing = cursor.fetchone()
    if existing is None or existing[0] != observed_at:
        raise ProjectionContractError("code label evidence conflicts")
    return 0


def resolve_observation(
    cursor: psycopg.Cursor[Any],
    observation: CodeObservation,
    *,
    observation_id: int,
    observed_at: datetime,
    allow_insert: bool,
) -> tuple[int, int, int]:
    """코드와 그 라벨을 함께 앉힌다. `(code_value_id, 코드 삽입 수, 라벨 삽입 수)`를 돌려준다."""
    code_value_id, code_inserted = resolve_code_value(
        cursor,
        namespace=observation.namespace,
        code=observation.code,
        allow_insert=allow_insert,
    )
    label_inserted = 0
    if observation.label is not None:
        label_inserted = resolve_label(
            cursor,
            code_value_id=code_value_id,
            label=observation.label,
            observation_id=observation_id,
            observed_at=observed_at,
            allow_insert=allow_insert,
        )
    return code_value_id, code_inserted, label_inserted
