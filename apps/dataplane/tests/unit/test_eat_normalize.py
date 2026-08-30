from __future__ import annotations

import json
from pathlib import Path

import pytest
from hypothesis import given
from hypothesis import strategies as st
from pydantic import ValidationError

from eatbid.generated.ingestion_v1 import EatbidIngestionAuctionV1
from eatbid.source.eat.models import BidListPage
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
    deadline_at: str = "20250619150000",
    base_amount: str = "10000000.10",
    planned_amount: str = "9990000.01",
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
        ("BID_END_DT", deadline_at),
        ("OPNG_DT", "20250620103000"),
        ("BGNG_PRC", base_amount),
        ("ELCTRN_BID_PLNPRC", planned_amount),
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


def test_normalize가_internal_identity와_display_number를_분리한다() -> None:
    record = normalize_bid_detail(
        FIXTURE.read_bytes(),
        external_bid_id="5610615",
        parser_version="eat-v1",
    )

    assert isinstance(record, EatbidIngestionAuctionV1)
    assert record.contract_version == "eatbid.ingestion.auction.v1"
    assert record.identity.external_bid_id == "5610615"
    assert record.identity.display_bid_number is not None
    assert record.identity.display_bid_number.root == "E250617-472599-1"
    assert record.buyer.organization_code == "153347"
    assert record.location.sido_code is not None
    assert record.location.sido_code.root == "15"
    assert record.location.sigungu_code is not None
    assert record.location.sigungu_code.root == "653"
    assert [code.root for code in record.location.eligibility_codes] == ["15653"]
    assert record.classification.source_category_label is not None
    assert record.classification.source_category_label.root == "원본 분류 라벨"
    assert record.classification.category_source == "source_field"
    assert record.pricing.base_amount is not None
    assert record.pricing.base_amount.amount == "10000000.00"


@given(code_tail=st.text(alphabet="0123456789", min_size=1, max_size=20))
def test_leading_zero_code가_validation_및_normalization_및_JSON_roundtrip에서_보존된다(
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

    assert record.identity.external_bid_id == code
    assert record.buyer.organization_code == code
    assert record.location.sido_code is not None
    assert record.location.sido_code.root == code
    assert record.location.sigungu_code is not None
    assert record.location.sigungu_code.root == code
    assert [item.root for item in record.location.eligibility_codes] == [code]
    assert restored["identity"]["externalBidId"] == code
    assert restored["buyer"]["organizationCode"] == code
    assert restored["location"]["eligibilityCodes"] == [code]


def test_generated_normalized_model는_엄격한_authority이다() -> None:
    with pytest.raises(ValidationError):
        EatbidIngestionAuctionV1.model_validate(
            {
                "contract_version": "eatbid.ingestion.auction.v1",
                "identity": {
                    "external_bid_id": 5610615,
                    "display_bid_number": None,
                    "title": "title",
                    "status": "status",
                },
                "buyer": {
                    "organization_code": "001",
                    "organization_name": "name",
                },
                "location": {
                    "sido_code": None,
                    "sigungu_code": None,
                    "eligibility_codes": [],
                },
                "schedule": {
                    "announced_at": None,
                    "deadline_at": None,
                    "opened_at": None,
                },
                "pricing": {"base_amount": None, "planned_amount": None},
                "classification": {
                    "source_category_label": None,
                    "category_source": "unknown",
                },
            }
        )


def test_bid_list_authority가_알_수_없는_fields을_금지한다() -> None:
    with pytest.raises(ValidationError):
        BidListPage.model_validate(
            {
                "total_count": 1,
                "external_bid_ids": ("1",),
                "unreviewed_field": "must not be discarded",
            }
        )


def test_generated_normalized_auction_authority가_알_수_없는_fields을_금지한다() -> None:
    record = normalize_bid_detail(
        FIXTURE.read_bytes(),
        external_bid_id="5610615",
        parser_version="eat-v1",
    )
    payload = record.model_dump()
    payload["unreviewed_field"] = "must not be discarded"

    with pytest.raises(ValidationError):
        EatbidIngestionAuctionV1.model_validate(payload)


def test_누락된_source_category는_title_추론_없이_unknown으로_남는다() -> None:
    record = normalize_bid_detail(
        detail_xml(main_items=None),
        external_bid_id="42",
        parser_version="eat-v1",
    )

    assert record.classification.source_category_label is None
    assert record.classification.category_source == "unknown"


def test_canonical_payload는_source_column_순서가_달라도_안정적이다() -> None:
    first = normalize_bid_detail(
        detail_xml(), external_bid_id="42", parser_version="eat-v1"
    )
    second = normalize_bid_detail(
        detail_xml(reverse_columns=True),
        external_bid_id="42",
        parser_version="eat-v1",
    )

    assert canonical_payload(first) == canonical_payload(second)
    assert canonical_payload(first).startswith(b'{"buyer":')
    assert b'"contractVersion":"eatbid.ingestion.auction.v1"' in canonical_payload(
        first
    )


def test_서울_source_time과_decimal_money가_canonical_wire_value로_변환된다() -> None:
    record = normalize_bid_detail(
        detail_xml(), external_bid_id="42", parser_version="eat-v1"
    )

    assert record.pricing.base_amount is not None
    assert record.pricing.base_amount.model_dump(mode="json") == {
        "amount": "10000000.10",
        "currency": "KRW",
    }
    assert record.pricing.planned_amount is not None
    assert record.pricing.planned_amount.amount == "9990000.01"
    assert record.schedule.announced_at is not None
    assert record.schedule.announced_at.root == "2025-06-16T15:00:00Z"
    assert record.schedule.deadline_at is not None
    assert record.schedule.deadline_at.root == "2025-06-19T06:00:00Z"
    assert record.schedule.opened_at is not None
    assert record.schedule.opened_at.root == "2025-06-20T01:30:00Z"


def test_서울_source_time은_고정_offset이_아니라_IANA_zone으로_해석된다() -> None:
    record = normalize_bid_detail(
        detail_xml(announced_at="19880601"),
        external_bid_id="42",
        parser_version="eat-v1",
    )

    assert record.schedule.announced_at is not None
    assert record.schedule.announced_at.root == "1988-05-31T14:00:00Z"


def test_서울_DST_gap의_존재하지_않는_wall_time은_typed_detail_error가_된다() -> None:
    with pytest.raises(EatDetailValidationError):
        normalize_bid_detail(
            detail_xml(deadline_at="19880508023000"),
            external_bid_id="42",
            parser_version="eat-v1",
        )


def test_서울_DST_overlap의_모호한_wall_time은_typed_detail_error가_된다() -> None:
    with pytest.raises(EatDetailValidationError):
        normalize_bid_detail(
            detail_xml(deadline_at="19881009023000"),
            external_bid_id="42",
            parser_version="eat-v1",
        )


def test_서울_DST_기간의_유일한_wall_time은_정확한_UTC_instant가_된다() -> None:
    record = normalize_bid_detail(
        detail_xml(deadline_at="19880601120000"),
        external_bid_id="42",
        parser_version="eat-v1",
    )

    assert record.schedule.deadline_at is not None
    assert record.schedule.deadline_at.root == "1988-06-01T02:00:00Z"


@pytest.mark.parametrize(
    "invalid_amount",
    ["-0.01", "1.001", "NaN", "Infinity", "-Infinity"],
)
def test_유효하지_않은_source_money는_typed_detail_error가_된다(
    invalid_amount: str,
) -> None:
    with pytest.raises(EatDetailValidationError):
        normalize_bid_detail(
            detail_xml(base_amount=invalid_amount),
            external_bid_id="42",
            parser_version="eat-v1",
        )


def test_유효하지_않은_source_datetime은_typed_detail_error가_된다() -> None:
    with pytest.raises(EatDetailValidationError):
        normalize_bid_detail(
            detail_xml(announced_at="2025-06-17"),
            external_bid_id="42",
            parser_version="eat-v1",
        )
