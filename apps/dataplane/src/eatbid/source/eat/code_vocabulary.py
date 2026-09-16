"""모듈 책임: eaT 공통 코드목록 응답의 `ds_out` 행을 검토된 그룹의 코드·이름·유효기간 어휘로 옮긴다.

전송 경계(`registry`·`payload`)와 나눈 이유는 함께 바뀌지 않기 때문이다. eaT가 요청 모양을 바꿔도
행 해석은 그대로이고, 그룹을 늘려도 전송 경계는 그대로다.
"""

from __future__ import annotations

from collections.abc import Mapping

from pydantic import ValidationError

from eatbid.failures.errors import SourceContractError
from eatbid.generated.code_vocabulary_v1 import (
    EatbidCodeVocabularyV1,
    NormalizedCodeVocabularyEntry,
)
from eatbid.source.eat.code_schemes import EatCodeListGroup, code_list_group, code_list_scheme
from eatbid.source.eat.wire_text import canonical_instant_text, optional_text
from eatbid.source.eat.wire_values_v2 import SOURCE_SYSTEM
from eatbid.source.eat.xml import ParsedNexacro

CODE_LIST_DATASET = "ds_out"

_GROUP_FIELD = "CMNS_GRP_CD"
_CODE_FIELD = "CMNS_CD"
_LABEL_FIELD = "CMNS_CD_NM"
_USE_FIELD = "USE_YN"
_DELETED_FIELD = "DEL_YN"
_VALID_FROM_FIELD = "VLD_BGNG_YMD"
_VALID_TO_FIELD = "VLD_END_YMD"
_SOURCE_DATE_FORMAT = "%Y%m%d"
_YES = "Y"
_NO = "N"
_FLAG_VALUES = frozenset({_YES, _NO})


def parse_code_vocabulary(parsed: ParsedNexacro) -> EatbidCodeVocabularyV1:
    """응답 한 장을 어휘 한 벌로 옮긴다. 옮기지 못한 행 수를 함께 세어 빠뜨림을 드러낸다.

    **검토되지 않은 그룹이 오면 멈춘다.** 우리가 물은 그룹은 `EAT_CODE_LIST_GROUPS` 넷뿐이므로 다섯째
    그룹은 소스가 응답 규칙을 바꿨다는 뜻이다. 그것을 제외 행으로 세고 넘어가면 우리가 모르는 어휘가
    "그냥 안 실린 것"으로 조용히 지나간다(AGENTS 3).

    **한 그룹의 코드가 중복되면 멈춘다.** 같은 코드가 두 이름으로 오면 어느 행이 그 코드의 사실인지
    우리가 고르게 된다. 고르지 않는다.
    """
    rows = parsed.datasets.get(CODE_LIST_DATASET)
    if not rows:
        raise SourceContractError("eaT code list returned no ds_out rows")

    entries: list[NormalizedCodeVocabularyEntry] = []
    seen: set[tuple[str, str]] = set()
    for row in rows:
        group = _require_group(row)
        namespace = group.scheme.namespace
        code = _required(row, _CODE_FIELD)
        key = (namespace, code)
        if key in seen:
            raise SourceContractError(
                f"eaT code list repeats a code [scheme={namespace} code={code}]"
            )
        seen.add(key)
        label = optional_text(row, _LABEL_FIELD)
        if label is None:
            # 이름 없는 행은 어휘가 되지 못한다. 코드만 싣고 이름을 비워 두면 화면이 "이름이 아직
            # 안 온 코드"와 "이름이 없는 코드"를 구분하지 못한다. 세어서 드러내고 넘어간다.
            continue
        # 값 해석 실패를 계약 위반으로 닫는 이유: 그냥 새어 나가면 `failure_category_for_element`가
        # 분류하지 못해 CONFIGURATION(우리 코드가 잘못됐다)으로 떨어진다. 소스가 모양을 바꾼 사건과
        # 우리가 설정을 틀린 사건은 운영에서 하는 일이 다르다.
        try:
            entry = NormalizedCodeVocabularyEntry.model_validate(
                {
                    "scheme": namespace,
                    "code": code,
                    "label": label,
                    "active": _active(row),
                    "validFrom": _instant(row, _VALID_FROM_FIELD),
                    "validTo": _instant(row, _VALID_TO_FIELD),
                    "parent": _parent(row, group),
                }
            )
        except (ValidationError, ValueError) as error:
            raise SourceContractError(
                f"eaT code list row is not readable "
                f"[scheme={namespace} code={code} error={error}]"
            ) from error
        entries.append(entry)
    return EatbidCodeVocabularyV1.model_validate(
        {
            "sourceSystem": SOURCE_SYSTEM,
            "dataset": CODE_LIST_DATASET,
            "sourceRowCount": len(rows),
            "excludedRowCount": len(rows) - len(entries),
            "entries": entries,
        }
    )


def _require_group(row: Mapping[str, str]) -> EatCodeListGroup:
    group_code = _required(row, _GROUP_FIELD)
    group = code_list_group(group_code)
    if group is None:
        raise SourceContractError(f"eaT code list group is not reviewed [group={group_code}]")
    return group


def _parent(row: Mapping[str, str], group: EatCodeListGroup) -> dict[str, str] | None:
    """소스가 이 행의 상위라고 적은 코드다. 그룹 표가 상위 column을 적은 그룹에서만 읽는다.

    비어 있으면 `None`이다 — 상위를 말하지 않은 시군구를 우리가 코드 자릿수로 어느 시도에 넣는 순간
    문자열이 정체성이 된다(AGENTS 2). 상위의 체계는 그룹 표가 짝지은 그룹의 체계다.
    """
    if group.parent_column is None or group.parent_group is None:
        return None
    code = optional_text(row, group.parent_column)
    if code is None:
        return None
    scheme = code_list_scheme(group.parent_group)
    if scheme is None:
        raise SourceContractError(
            f"eaT code list parent group is not reviewed [group={group.parent_group}]"
        )
    return {"scheme": scheme.namespace, "code": code}


def _required(row: Mapping[str, str], field: str) -> str:
    value = optional_text(row, field)
    if value is None:
        raise SourceContractError(f"eaT code list row is missing {field}")
    return value


def _active(row: Mapping[str, str]) -> bool:
    """소스가 지금 쓰는 코드라고 말했는가.

    `USE_YN='N'`이나 `DEL_YN='Y'`인 행도 어휘에서 빼지 않는다. 과거 공고가 그 코드를 참조하고 있어서
    지우면 그 공고의 지역·상태가 이름을 잃는다. 실린 채로 `active`만 내린다.

    두 표시 모두 `Y`/`N` 밖의 값은 계약 위반이다. 모르는 값을 `N`으로 읽으면 소스가 세 번째 상태를
    도입한 날 우리가 그것을 "안 쓰는 코드"라고 단정하게 된다.
    """
    use = _required(row, _USE_FIELD)
    deleted = _required(row, _DELETED_FIELD)
    if use not in _FLAG_VALUES or deleted not in _FLAG_VALUES:
        raise SourceContractError(
            f"eaT code list flag is not Y or N [use={use} deleted={deleted}]"
        )
    return use == _YES and deleted == _NO


def _instant(row: Mapping[str, str], field: str) -> str | None:
    """유효기간 한쪽을 소스가 준 서울 벽날짜 그대로 instant로 읽는다.

    `99991231`·`29991231`이 소스의 무한 표기처럼 보이지만 null로 번역하지 않는다. 번역하는 순간
    "소스가 끝을 말하지 않았다"와 "소스가 먼 끝을 말했다"가 한 값이 되고, 그 차이를 우리가 지운
    사실은 어디에도 남지 않는다(AGENTS 3).
    """
    return canonical_instant_text(row, field, _SOURCE_DATE_FORMAT)
