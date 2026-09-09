"""모듈 책임: 행안부 법정동코드 표의 행을 승격 grain만 남긴 code release 계약 값으로 옮긴다.

다운로드·인코딩 경계(`mois_client.py`)와 나눈 이유는 함께 바뀌지 않기 때문이다. 소스가 전송
방식을 바꿔도 행 해석은 그대로이고, 승격 규칙을 바꿔도 전송 경계는 그대로다.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Sequence

from eatbid.code_labels import label_path_parent, normalize_code_label
from eatbid.failures.errors import SourceContractError
from eatbid.generated.code_release_v1 import (
    EatbidCodeReleaseV1,
    NormalizedCodeReleaseMember,
)
from eatbid.source.reference.source_contracts import ReferenceDatasetContract

SIDO_GRAIN = "sido"
SIGUNGU_GRAIN = "sigungu"
PROMOTED_GRAINS: tuple[str, ...] = (SIDO_GRAIN, SIGUNGU_GRAIN)

# 법정동코드 10자리는 행정안전부가 공표한 시도(2)+시군구(3)+읍면동(3)+리(2) 규격이다. 이 분해는
# 우리가 지어낸 것이 아니라 소스의 규격이며, 실측으로 비함수임이 확인된 eaT `PDLC_CD` 자릿수
# 분해와는 다른 사안이다(ADR 0035 Rejected alternatives).
_SIDO_WIDTH = 2
_SIGUNGU_WIDTH = 3


def code_grain(code: str) -> str | None:
    """승격 대상 grain 이름을 돌려준다. 읍면동·리는 제품에 그 축의 결정이 없어 `None`이다."""
    sigungu = code[_SIDO_WIDTH : _SIDO_WIDTH + _SIGUNGU_WIDTH]
    below = code[_SIDO_WIDTH + _SIGUNGU_WIDTH :]
    if sigungu == "0" * _SIGUNGU_WIDTH and below == "0" * len(below):
        return SIDO_GRAIN
    if sigungu != "0" * _SIGUNGU_WIDTH and below == "0" * len(below):
        return SIGUNGU_GRAIN
    return None


def parse_legal_dong_release(
    rows: Sequence[Sequence[str]],
    *,
    contract: ReferenceDatasetContract,
    source_id: str,
    source_version: str,
) -> EatbidCodeReleaseV1:
    """표 전체를 release 하나로 옮긴다. 승격하지 않은 행 수를 함께 세어 빠뜨림을 드러낸다."""
    payload = contract.payload
    scheme = contract.scheme
    if payload is None or scheme is None:
        raise SourceContractError(
            f"reference dataset has no reviewed payload or scheme: {contract.dataset}"
        )
    positions = {name: index for index, name in enumerate(payload.columns)}
    code_at = positions[payload.code_column]
    label_at = positions[payload.label_column]
    state_at = positions[payload.state_column]

    promoted: list[tuple[str, str, str, bool]] = []
    seen_codes: set[str] = set()
    for row in rows:
        code = row[code_at].strip()
        label = row[label_at]
        state = row[state_at].strip()
        if len(code) != payload.code_length or not code.isascii() or not code.isdecimal():
            raise SourceContractError(
                f"reference code width changed: {contract.dataset}"
            )
        if state not in {payload.active_state, payload.retired_state}:
            raise SourceContractError(
                f"reference state value is unknown: {contract.dataset}"
            )
        if code in seen_codes:
            # 같은 코드가 두 번 오면 어느 행이 그 코드의 사실인지 우리가 고르게 된다. 고르지 않는다.
            raise SourceContractError(f"reference code is duplicated: {contract.dataset}")
        seen_codes.add(code)
        grain = code_grain(code)
        if grain is None:
            continue
        promoted.append((code, label, grain, state == payload.active_state))

    parents = _unique_label_index(promoted)
    members = [
        NormalizedCodeReleaseMember.model_validate(
            {
                "scheme": scheme,
                "code": code,
                "label": label,
                "parentCode": _parent_code(label, parents),
                "active": active,
                # 전체자료에 날짜 컬럼이 없다. 관측하지 않은 경계를 만들지 않는다(ADR 0035 결정 4).
                "validFrom": None,
                "validTo": None,
            }
        )
        for code, label, _grain, active in promoted
    ]
    return EatbidCodeReleaseV1.model_validate(
        {
            "sourceSystem": source_id,
            "dataset": contract.dataset,
            "scheme": scheme,
            "sourceVersion": source_version,
            "publishedAt": None,
            "promotedGrain": list(PROMOTED_GRAINS),
            "sourceRowCount": len(rows),
            "excludedRowCount": len(rows) - len(members),
            "members": members,
        }
    )


def member_grain(member: NormalizedCodeReleaseMember) -> str:
    """member 하나의 승격 grain이다. 투영이 release 밖에서 grain을 다시 계산하지 않게 한다."""
    grain = code_grain(member.code)
    if grain is None:
        raise SourceContractError(f"promoted member has no reviewed grain: {member.code}")
    return grain


def _unique_label_index(
    promoted: Sequence[tuple[str, str, str, bool]],
) -> dict[str, str]:
    """정규화 라벨이 **유일한** 승격 행만 상위 후보로 남긴다.

    같은 이름이 둘 이상이면 상위를 우리가 고르게 되므로 아예 후보에서 뺀다. 후보 2개 이상이면 행을
    만들지 않는다는 규칙이 계층에도 그대로 적용된다(ADR 0035 결정 3).
    """
    counts = Counter(normalize_code_label(label) for _code, label, _grain, _active in promoted)
    return {
        normalize_code_label(label): code
        for code, label, _grain, _active in promoted
        if counts[normalize_code_label(label)] == 1
    }


def _parent_code(label: str, parents: dict[str, str]) -> str | None:
    parent_label = label_path_parent(label)
    if parent_label is None:
        return None
    return parents.get(parent_label)
