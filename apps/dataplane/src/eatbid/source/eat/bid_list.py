"""모듈 책임: 검토된 eaT 목록 응답을 발견 manifest가 쓰는 목록 페이지 모델로 해석한다."""

from __future__ import annotations

import re
from collections.abc import Mapping
from decimal import InvalidOperation

from pydantic import ValidationError

from eatbid.failures.errors import SourceContractError
from eatbid.source.eat.models import BidListPage, BidListRow
from eatbid.source.eat.payload import MAX_ELECTRONIC_BID_ID_DIGITS
from eatbid.source.eat.schema_contract import reviewed_schema_contract
from eatbid.source.eat.wire_text import optional_text, required_text
from eatbid.source.eat.wire_values import (
    optional_instant_text,
    optional_money,
    optional_source_code,
)
from eatbid.source.eat.xml import parse_nexacro

_NONNEGATIVE_DECIMAL = re.compile(r"0|[1-9][0-9]*")
_POSITIVE_DECIMAL = re.compile(r"[1-9][0-9]*")

_TOTAL_COUNT_FIELD = "TOT_CNT"
_EXTERNAL_BID_ID_FIELD = "ETN_BID_ID"
_COMPETITOR_COUNT_FIELD = "BID_CNT"
_LIST_STATUS_FIELD = "ETN_BID_STT_NM"
_LIST_DEADLINE_FIELD = "BID_END_DT"
_LIST_LAST_CHANGED_FIELD = "LAST_CHG_DT"
_PARSED_REQUIRED_FIELDS = frozenset(
    {
        _TOTAL_COUNT_FIELD,
        _EXTERNAL_BID_ID_FIELD,
        _COMPETITOR_COUNT_FIELD,
        _LIST_STATUS_FIELD,
        _LIST_DEADLINE_FIELD,
        _LIST_LAST_CHANGED_FIELD,
    }
)


def _list_dataset(parser_version: str) -> str:
    """실행 단위의 parser version으로 목록 계약을 찾고 파서와 어긋나지 않는지 검사한다.

    왜 import 시점 상수가 아닌가. 여기서 version을 고정하면 새 parser version으로 도는 발견이 예전
    계약의 필수 column으로 검증되고, 목록 계약이 갈라져도 아무도 알아채지 못한다. 실패는 발견
    단계가 아니라 한참 뒤 fingerprint 불일치로 드러난다. 상세 경로(`pipeline/normalize.py`)가 같은
    이유로 registry에서 계약을 읽는다.
    """
    contract = reviewed_schema_contract(
        source="eat", endpoint="bid-list", parser_version=parser_version
    )
    if contract is None:
        raise SourceContractError(
            f"reviewed bid-list schema contract is unknown [parser_version={parser_version}]"
        )
    (dataset,) = tuple(contract.datasets)
    if set(contract.required_datasets[dataset]) != _PARSED_REQUIRED_FIELDS:
        raise SourceContractError(
            "bid-list parser and reviewed required columns diverged "
            f"[parser_version={parser_version}]"
        )
    return dataset


def parse_bid_list_page(payload: bytes, *, parser_version: str) -> BidListPage:
    dataset = _list_dataset(parser_version)
    parsed = parse_nexacro(payload)
    rows = parsed.datasets.get(dataset)
    if not rows:
        raise SourceContractError(f"{dataset} must contain at least one row")

    totals = {row.get(_TOTAL_COUNT_FIELD, "") for row in rows}
    if len(totals) != 1:
        raise SourceContractError(
            f"{_TOTAL_COUNT_FIELD} must be stable across a list page"
        )
    total_text = next(iter(totals))
    if _NONNEGATIVE_DECIMAL.fullmatch(total_text) is None:
        raise SourceContractError(
            f"{_TOTAL_COUNT_FIELD} must be nonnegative ASCII decimal text"
        )

    total_count = int(total_text)
    wire_ids = tuple(row.get(_EXTERNAL_BID_ID_FIELD, "") for row in rows)
    if total_count == 0 and wire_ids == ("",):
        return BidListPage(total_count=0, rows=())
    if any(
        _POSITIVE_DECIMAL.fullmatch(source_id) is None
        or len(source_id) > MAX_ELECTRONIC_BID_ID_DIGITS
        for source_id in wire_ids
    ):
        raise SourceContractError(
            f"{_EXTERNAL_BID_ID_FIELD} must be bounded positive ASCII decimal text"
        )
    if len(set(wire_ids)) != len(wire_ids):
        raise SourceContractError(
            f"{_EXTERNAL_BID_ID_FIELD} must be unique within a page"
        )
    if len(wire_ids) > total_count:
        raise SourceContractError(f"page row count exceeds {_TOTAL_COUNT_FIELD}")
    return BidListPage(
        total_count=total_count, rows=tuple(_bid_list_row(row) for row in rows)
    )


def _bid_list_row(row: Mapping[str, str]) -> BidListRow:
    """목록 행의 검토된 column을 해석한다. 필수 column의 부재나 잘못된 값은 발견 전체의 계약 위반이다.

    목록 응답은 상세와 이름이 같은 column을 여럿 갖는데 **뜻이 같지 않다**(`docs/SOURCE-FIELDS.md`).

    - `PLNPRCE_SUCBD_STD`는 상세의 여집합(`100 −` 하한율)이라 읽지 않는다(T4). 하한율은 상세에서만 만든다.
    - `SUCBD_DECISION_MTHD_NM`은 이름 그대로만 싣는다. 목록판은 대괄호 안이 비어 있어 하한율을
      문장에서 복원할 수 없고, 상세판과 문자열도 다르다(T16).
    - `LIMIT_CONDITION_NM`은 상세와 다른 짧은 문자열이라 이름으로 조인하면 깨진다(T8). 그래서 읽지 않는다.
    """
    try:
        competitor_text = required_text(row, _COMPETITOR_COUNT_FIELD)
        if _NONNEGATIVE_DECIMAL.fullmatch(competitor_text) is None:
            raise ValueError(
                f"{_COMPETITOR_COUNT_FIELD} must be nonnegative ASCII decimal text"
            )
        deadline_at = optional_instant_text(row, _LIST_DEADLINE_FIELD, "%Y%m%d%H%M%S")
        last_changed_at = optional_instant_text(
            row, _LIST_LAST_CHANGED_FIELD, "%Y%m%d%H%M%S"
        )
        if deadline_at is None or last_changed_at is None:
            raise ValueError(
                f"{_LIST_DEADLINE_FIELD} and {_LIST_LAST_CHANGED_FIELD} are required"
            )
        return BidListRow(
            external_bid_id=required_text(row, _EXTERNAL_BID_ID_FIELD),
            competitor_count=int(competitor_text),
            status_name=required_text(row, _LIST_STATUS_FIELD),
            deadline_at=deadline_at,
            last_changed_at=last_changed_at,
            base_amount=optional_money(row, "STRPRCE"),
            planned_price_type_name=optional_text(row, "PLNPRCE_TYPE_NM"),
            buyer_organization_code=optional_source_code(row, "PURR_CD"),
            buyer_organization_name=optional_text(row, "PURR_NM"),
            award_method_name=optional_text(row, "SUCBD_DECISION_MTHD_NM"),
        )
    except (InvalidOperation, ValidationError, ValueError) as error:
        raise SourceContractError(f"invalid eaT list field: {error}") from None
