"""모듈 책임: 소스가 공개한 코드목록 관측 하나를 `core.code_value`의 유효기간·사용 여부와
`core.code_label_observation`의 이름으로 앉히고, 같은 관측을 두 번 투영해도 행이 늘지 않게 한다.

`code_release_projection`과 나눈 이유는 두 입력이 말하는 사실이 다르기 때문이다. 정부 파일은 "코드
계층 한 벌을 새로 선언한다"고 말하므로 release와 member가 필요하고, 코드목록은 "이미 관측한 코드에
소스가 이 이름과 유효기간을 붙여 부른다"고만 말한다. 코드목록으로 release를 만들면 그 체계에
활성 release가 생기고, release의 존재를 전환 신호로 읽는 mart 지역 축이 시도와 시군구를 한 체계로
강제하기 시작한다(`mart/region_axis.py`). 어휘를 채우는 일이 지역 축 전환을 촉발하면 안 된다.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

import psycopg

from eatbid.core.postgres_code_values import resolve_label
from eatbid.core.repository import ProjectionContractError
from eatbid.generated.code_vocabulary_v1 import (
    EatbidCodeVocabularyV1,
    NormalizedCodeVocabularyEntry,
)


@dataclass(frozen=True, slots=True)
class CodeVocabularyProjectionResult:
    """한 번의 투영이 실제로 만든 것과, 비활성으로 내린 코드 수를 함께 보고한다."""

    entry_count: int
    inserted_code_values: int
    inserted_labels: int
    deactivated_code_values: int


def project_code_vocabulary(
    cursor: psycopg.Cursor[Any],
    vocabulary: EatbidCodeVocabularyV1,
    *,
    observation_id: int,
    observed_at: datetime,
) -> CodeVocabularyProjectionResult:
    """봉인된 코드목록 관측 하나가 말한 이름과 유효기간을 core에 앉힌다.

    라벨의 `observation_id`는 **이 코드목록 관측**이다. 공고 관측을 빌려 쓰면 "이 이름을 어디서
    들었는가"가 거짓이 되고, 코드목록이 이름을 바꾼 날 그 변화가 공고 관측의 사실로 보인다.
    """
    scheme_ids: dict[str, int] = {}
    inserted_code_values = 0
    inserted_labels = 0
    deactivated = 0
    for entry in vocabulary.entries:
        if entry.scheme not in scheme_ids:
            scheme_ids[entry.scheme] = _require_scheme(cursor, entry.scheme)
        code_value_id, inserted = _upsert_code_value(
            cursor, entry, scheme_id=scheme_ids[entry.scheme]
        )
        inserted_code_values += inserted
        if not entry.active:
            deactivated += 1
        inserted_labels += resolve_label(
            cursor,
            code_value_id=code_value_id,
            label=entry.label,
            observation_id=observation_id,
            observed_at=observed_at,
            allow_insert=True,
        )
    return CodeVocabularyProjectionResult(
        entry_count=len(vocabulary.entries),
        inserted_code_values=inserted_code_values,
        inserted_labels=inserted_labels,
        deactivated_code_values=deactivated,
    )


def _require_scheme(cursor: psycopg.Cursor[Any], namespace: str) -> int:
    """등록되지 않은 체계는 여기서 만들지 않는다. 시드가 소유하는 목록이 투영 경로에서 조용히
    넓어지면 어떤 어휘가 검토를 거쳤는지 아무도 말할 수 없다(ADR 0006)."""
    cursor.execute(
        "select code_scheme_id from core.code_scheme where namespace = %s",
        (namespace,),
    )
    row = cursor.fetchone()
    if row is None:
        raise ProjectionContractError(f"reviewed code scheme is missing: {namespace}")
    return int(row[0])


def _upsert_code_value(
    cursor: psycopg.Cursor[Any],
    entry: NormalizedCodeVocabularyEntry,
    *,
    scheme_id: int,
) -> tuple[int, int]:
    """코드 하나의 유효기간과 사용 여부를 소스가 지금 말한 값으로 맞춘다.

    왜 덮어쓰나. 이 세 열은 우리가 만든 사실이 아니라 소스가 자기 코드에 대해 말하는 상태이고, 체계
    등록이 `source-managed`라고 선언한 바로 그 부분이다. 나중 관측이 이긴다 — 유효기간이 바뀐 날
    옛 값이 남아 있으면 "지금 쓰는 코드인가"를 우리가 옛 관측으로 답하게 된다.

    정체성(`code_scheme_id`, `code`)은 건드리지 않는다. 공고 투영이 이미 만들어 둔 code value가
    있으면 같은 행을 채우고, 새 코드면 그 자리에서 만든다.
    """
    cursor.execute(
        """
        insert into core.code_value (code_scheme_id, code, valid_from, valid_to, active)
        values (%s, %s, %s, %s, %s)
        on conflict (code_scheme_id, code) do update
           set valid_from = excluded.valid_from,
               valid_to = excluded.valid_to,
               active = excluded.active
        returning code_value_id, (xmax = 0) as inserted
        """,
        (
            scheme_id,
            entry.code,
            None if entry.valid_from is None else entry.valid_from.root,
            None if entry.valid_to is None else entry.valid_to.root,
            entry.active,
        ),
    )
    row = cursor.fetchone()
    if row is None:
        raise ProjectionContractError(
            f"code value could not be resolved: {entry.scheme}/{entry.code}"
        )
    return int(row[0]), 1 if row[1] else 0
