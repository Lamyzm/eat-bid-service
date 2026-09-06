"""모듈 책임: 좌표 관측을 활성 code release의 코드에 유일 대응으로만 붙이고, 붙지 못한 것을 센다.

release 투영과 나눈 모듈인 이유는 좌표 소스가 코드 소스와 다른 수명주기를 갖기 때문이다. 좌표
파일을 갈아도 이 모듈만 바뀐다(ADR 0035 결정 5).
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

import psycopg

from eatbid.code_labels import label_path_segments
from eatbid.core.repository import ProjectionContractError
from eatbid.source.reference.centroid_parser import CENTROID_CRS, ObservedCentroid


@dataclass(frozen=True, slots=True)
class CoordinateProjectionResult:
    """좌표를 몇 개 붙였고 무엇이 붙지 않았는지를 함께 보고한다.

    결측 목록을 결과에 싣는 이유는, 좌표 없는 시군구가 지도에 서지 않는다는 사실이 실행 로그에
    남아야 하기 때문이다. 조용히 비면 화면이 "그 지역에 공고가 없다"처럼 보인다(PDR-0003).
    """

    inserted_count: int
    unmatched_source_paths: tuple[tuple[str, ...], ...]
    codes_without_coordinate: tuple[str, ...]


def project_code_value_coordinates(
    cursor: psycopg.Cursor[Any],
    observed: Sequence[ObservedCentroid],
    *,
    code_release_id: int,
    observation_id: int,
) -> CoordinateProjectionResult:
    """이름 경로가 release 안에서 유일할 때만 좌표 행을 만든다.

    결측을 모구 좌표로 채우지 않는 이유는 실측이다. 2026-07 인천 개편으로 생긴 영종구를 인천 중구
    좌표로 채우면 그 점이 바다 건너에 선다. 없는 것은 없는 채로 둔다.
    """
    index, all_codes = _release_label_index(cursor, code_release_id)
    matched_code_values: set[int] = set()
    unmatched: list[tuple[str, ...]] = []
    inserted = 0
    for item in observed:
        code_value_id = index.get(item.path)
        if code_value_id is None:
            unmatched.append(item.path)
            continue
        cursor.execute(
            """
            insert into core.code_value_coordinate (
                code_value_id, code_release_id, latitude, longitude, crs,
                evidence_observation_id
            ) values (%s, %s, %s, %s, %s, %s)
            on conflict (code_release_id, code_value_id) do nothing
            returning code_value_coordinate_id
            """,
            (
                code_value_id,
                code_release_id,
                item.latitude,
                item.longitude,
                CENTROID_CRS,
                observation_id,
            ),
        )
        if cursor.fetchone() is not None:
            inserted += 1
        matched_code_values.add(code_value_id)
    missing = tuple(
        code for code_value_id, code in all_codes.items() if code_value_id not in matched_code_values
    )
    return CoordinateProjectionResult(
        inserted_count=inserted,
        unmatched_source_paths=tuple(unmatched),
        codes_without_coordinate=missing,
    )


def _release_label_index(
    cursor: psycopg.Cursor[Any], code_release_id: int
) -> tuple[dict[tuple[str, ...], int], dict[int, str]]:
    """release의 member 라벨을 이름 경로 → code_value_id로 색인한다.

    같은 경로가 둘 이상이면 색인에서 뺀다. 후보가 둘 이상일 때 행을 만들지 않는다는 규칙은
    매핑과 좌표에 똑같이 적용된다.
    """
    cursor.execute(
        """
        select m.code_value_id, v.code, o.label
        from core.code_release_member m
        join core.code_value v on v.code_value_id = m.code_value_id
        left join core.code_label_observation o on o.code_value_id = m.code_value_id
        where m.code_release_id = %s
        """,
        (code_release_id,),
    )
    rows = cursor.fetchall()
    if not rows:
        raise ProjectionContractError("code release has no members to place")
    codes = {int(row[0]): str(row[1]) for row in rows}
    paths = [
        (label_path_segments(str(row[2])), int(row[0]))
        for row in rows
        if row[2] is not None
    ]
    counts = Counter(path for path, _code_value_id in paths)
    return {
        path: code_value_id for path, code_value_id in paths if counts[path] == 1
    }, codes
