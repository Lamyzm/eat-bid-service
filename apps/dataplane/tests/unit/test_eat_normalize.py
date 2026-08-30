from __future__ import annotations

import json
from pathlib import Path

import pytest
from hypothesis import given
from hypothesis import strategies as st
from pydantic import ValidationError

from eatbid.source.eat.models import BidListPage, NormalizedAuction
from eatbid.source.eat.normalize import (
    EatDetailValidationError,
    canonical_payload,
    normalize_bid_detail,
)

FIXTURE = Path(__file__).parents[1] / "fixtures" / "eat" / "bid-detail-one.xml"
NS = "http://www.nexacroplatform.com/platform/dataset"


def detail_xml(
    *,
    organization_code: str = "0012",
    sido_code: str = "03",
    sigungu_code: str = "004",
    eligibility_code: str = "03004",
    main_items: str | None = "source label",
    announced_at: str = "20250617",
    reverse_columns: bool = False,
) -> bytes:
    values = [
        ("ELCTRN_BID_NO", "DISPLAY-1"),
        ("BID_NM", "title that must not become identity or category"),
        ("ELCTRN_BID_STT_NM", "source-status"),
        ("PURR_CD", organization_code),
        ("PURR_NM", "synthetic organization"),
        ("SIDO_CD", sido_code),
        ("SIGUNGU_CD", sigungu_code),
        ("PBANC_YMD", announced_at),
        ("BID_END_DT", "20250619150000"),
        ("OPNG_DT", "20250620103000"),
        ("BGNG_PRC", "10000000.10"),
        ("ELCTRN_BID_PLNPRC", "9990000.01"),
    ]
    if main_items is not None:
        values.append(("MAIN_ITEMS", main_items))
    if reverse_columns:
        values.reverse()
    columns = "".join(f'<Col id="{key}">{value}</Col>' for key, value in values)
    return (
        f'<Root xmlns="{NS}"><Dataset id="ds_info"><Rows><Row>{columns}</Row>'
        f'</Rows></Dataset><Dataset id="ds_areaList"><Rows><Row>'
        f'<Col id="PDLC_CD">{eligibility_code}</Col></Row></Rows></Dataset></Root>'
    ).encode()


def test_normalize_separates_internal_identity_from_display_number_동작을_검증한다() -> None:
    record = normalize_bid_detail(
        FIXTURE.read_bytes(),
        external_bid_id="5610615",
        parser_version="eat-v1",
    )

    assert record.external_bid_id == "5610615"
    assert record.display_bid_no == "E250617-472599-1"
    assert record.organization_code == "153347"
    assert record.sido_code == "15"
    assert record.sigungu_code == "653"
    assert record.eligibility_codes == ("15653",)
    assert record.source_category_label == "원본 분류 라벨"
    assert record.category_source == "source_field"
    assert str(record.base_amount) == "10000000"


@given(code_tail=st.text(alphabet="0123456789", min_size=1, max_size=20))
def test_leading_zero_codes_survive_validation_normalization_and_json_roundtrip_동작을_검증한다(
    code_tail: str,
) -> None:
    code = f"0{code_tail}"
    record = normalize_bid_detail(
        detail_xml(
            organization_code=code,
            sido_code=code,
            sigungu_code=code,
            eligibility_code=code,
        ),
        external_bid_id=code,
        parser_version="eat-v1",
    )
    restored = json.loads(canonical_payload(record))

    assert record.external_bid_id == code
    assert record.organization_code == code
    assert record.sido_code == code
    assert record.sigungu_code == code
    assert record.eligibility_codes == (code,)
    assert restored["external_bid_id"] == code
    assert restored["organization_code"] == code
    assert restored["eligibility_codes"] == [code]


def test_정규화된_model_is_strict_authority() -> None:
    with pytest.raises(ValidationError):
        NormalizedAuction.model_validate(
            {
                "external_bid_id": 5610615,
                "display_bid_no": None,
                "title": "title",
                "source_status": "status",
                "organization_code": "001",
                "organization_name": "name",
                "sido_code": None,
                "sigungu_code": None,
                "eligibility_codes": (),
                "announced_at": None,
                "deadline_at": None,
                "opened_at": None,
                "base_amount": None,
                "planned_amount": None,
                "source_category_label": None,
                "category_source": "unknown",
            }
        )


def test_bid_list_authority_forbids_unknown_fields_동작을_검증한다() -> None:
    with pytest.raises(ValidationError):
        BidListPage.model_validate(
            {
                "total_count": 1,
                "external_bid_ids": ("1",),
                "unreviewed_field": "must not be discarded",
            }
        )


def test_정규화된_auction_authority_forbids_unknown_fields() -> None:
    record = normalize_bid_detail(
        FIXTURE.read_bytes(),
        external_bid_id="5610615",
        parser_version="eat-v1",
    )
    payload = record.model_dump()
    payload["unreviewed_field"] = "must not be discarded"

    with pytest.raises(ValidationError):
        NormalizedAuction.model_validate(payload)


def test_누락된_source_category_stays_unknown_without_title_inference() -> None:
    record = normalize_bid_detail(
        detail_xml(main_items=None),
        external_bid_id="42",
        parser_version="eat-v1",
    )

    assert record.source_category_label is None
    assert record.category_source == "unknown"


def test_canonical_payload_is_stable_across_source_column_order_동작을_검증한다() -> None:
    first = normalize_bid_detail(
        detail_xml(), external_bid_id="42", parser_version="eat-v1"
    )
    second = normalize_bid_detail(
        detail_xml(reverse_columns=True),
        external_bid_id="42",
        parser_version="eat-v1",
    )

    assert canonical_payload(first) == canonical_payload(second)
    assert canonical_payload(first).startswith(b'{"announced_at":')


def test_decimal_and_datetime_values_use_explicit_lossless_source_formats_동작을_검증한다() -> None:
    record = normalize_bid_detail(
        detail_xml(), external_bid_id="42", parser_version="eat-v1"
    )

    assert str(record.base_amount) == "10000000.10"
    assert str(record.planned_amount) == "9990000.01"
    assert record.announced_at is not None
    assert record.announced_at.isoformat() == "2025-06-17T00:00:00+09:00"
    assert record.deadline_at is not None
    assert record.deadline_at.isoformat() == "2025-06-19T15:00:00+09:00"


def test_유효하지_않은_source_datetime_is_a_typed_detail_error() -> None:
    with pytest.raises(EatDetailValidationError):
        normalize_bid_detail(
            detail_xml(announced_at="2025-06-17"),
            external_bid_id="42",
            parser_version="eat-v1",
        )
