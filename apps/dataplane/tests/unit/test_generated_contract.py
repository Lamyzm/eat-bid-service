from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from eatbid.generated import EatbidIngestionAuctionV1, EatbidIngestionAuctionV2

_FIXTURE_ROOT = Path(__file__).parents[4] / "packages" / "contracts" / "fixtures"
FIXTURE = _FIXTURE_ROOT / "ingestion-v1" / "normalized-auction.json"
FIXTURE_V2 = _FIXTURE_ROOT / "ingestion-v2" / "normalized-auction.json"


def golden_payload() -> dict[str, object]:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def golden_payload_v2() -> dict[str, object]:
    return json.loads(FIXTURE_V2.read_text(encoding="utf-8"))


def test_golden_fixture가_generated_root_model을_검증한다() -> None:
    model = EatbidIngestionAuctionV1.model_validate(golden_payload())

    assert model.contract_version == "eatbid.ingestion.auction.v1"
    assert model.identity.external_bid_id == "ETN-2026-000001"


@pytest.mark.parametrize("path", [(), ("identity",)])
def test_generated_model이_알_수_없는_fields를_거부한다(
    path: tuple[str, ...],
) -> None:
    payload = copy.deepcopy(golden_payload())
    if path:
        nested = payload[path[0]]
        assert isinstance(nested, dict)
        target = nested
    else:
        target = payload
    target["unexpectedField"] = "must fail"

    with pytest.raises(ValidationError):
        EatbidIngestionAuctionV1.model_validate(payload)


def test_generated_model이_leading_zero_codes를_문자열로_보존한다() -> None:
    model = EatbidIngestionAuctionV1.model_validate(golden_payload())

    assert model.buyer.organization_code == "00001234"
    assert [code.root for code in model.location.eligibility_codes] == ["001", "01002"]


def test_required_nullable_field는_누락을_거부하고_null을_허용한다() -> None:
    payload = golden_payload()
    identity = payload["identity"]
    assert isinstance(identity, dict)
    identity.pop("displayBidNumber")

    with pytest.raises(ValidationError):
        EatbidIngestionAuctionV1.model_validate(payload)

    payload = golden_payload()
    model = EatbidIngestionAuctionV1.model_validate(payload)
    assert model.identity.display_bid_number is None


@pytest.mark.parametrize(
    "unicode_instant",
    ["٢٠٢٦-08-30T00:00:00Z", "2026-08-30T0١:00:00Z"],
)
def test_generated_model이_ASCII가_아닌_Unicode_숫자를_거부한다(
    unicode_instant: str,
) -> None:
    payload = golden_payload()
    schedule = payload["schedule"]
    assert isinstance(schedule, dict)
    schedule["announcedAt"] = unicode_instant

    with pytest.raises(ValidationError):
        EatbidIngestionAuctionV1.model_validate(payload)


def test_alias_json_dump가_golden_logical_json을_재현한다() -> None:
    payload = golden_payload()
    model = EatbidIngestionAuctionV1.model_validate(payload)

    assert model.model_dump(by_alias=True, mode="json") == payload


def test_v2_golden_fixture가_alias_왕복에서_바뀌지_않는다() -> None:
    payload = golden_payload_v2()

    model = EatbidIngestionAuctionV2.model_validate(payload)

    assert model.contract_version == "eatbid.ingestion.auction.v2"
    assert model.model_dump(by_alias=True, mode="json", exclude_unset=True) == payload


def test_v2_참가제한지역_라벨은_원문_그대로_실리고_공백_변이도_보존된다() -> None:
    model = EatbidIngestionAuctionV2.model_validate(golden_payload_v2())

    areas = model.location.eligibility_areas
    assert areas is not None
    assert [area.code for area in areas] == ["001", "01002"]
    assert [area.label.root if area.label else None for area in areas] == [
        "서울 / 전체",
        "서울/종로구",
    ]


def test_라벨_키가_없는_봉인된_v2_payload는_그대로_통과하고_재직렬화에_새_키를_내지_않는다() -> None:
    """ADR 0038: optional 가산 필드는 producer가 쓰지 않은 키를 재직렬화가 만들어 내지 않아야 한다."""
    payload = golden_payload_v2()
    location = payload["location"]
    assert isinstance(location, dict)
    del location["eligibilityAreas"]

    model = EatbidIngestionAuctionV2.model_validate(payload)

    assert model.location.eligibility_areas is None
    assert model.model_dump(by_alias=True, mode="json", exclude_unset=True) == payload
    assert "eligibilityAreas" in model.model_dump(by_alias=True, mode="json")["location"]


def test_v2_generated_model이_선행_0을_코드_문자열로_보존한다() -> None:
    model = EatbidIngestionAuctionV2.model_validate(golden_payload_v2())

    submission = model.roster.submissions[0]
    assert submission.supplier_account.account_code.code == "0200000"
    assert submission.supplier_account.business_number is not None
    assert submission.supplier_account.business_number.code == "0100000000"
    assert [number.root for number in submission.draw_numbers] == ["07", "3"]
    # 추첨번호가 가리키는 후보 순번도 같은 source code라 선행 0이 살아 있다.
    assert [
        candidate.sequence for candidate in model.reserve_price_draw.candidates
    ] == ["07", "3"]


def test_v2_generated_model이_일을_넘는_추첨_배율을_받아들인다() -> None:
    model = EatbidIngestionAuctionV2.model_validate(golden_payload_v2())

    assert model.reserve_price_draw.candidates[1].ratio.value == "1.021800"


@pytest.mark.parametrize(
    "path", [(), ("roster",), ("terms",), ("lineage",), ("reservePriceDraw",)]
)
def test_v2_generated_model이_알_수_없는_fields를_거부한다(
    path: tuple[str, ...],
) -> None:
    payload = golden_payload_v2()
    if path:
        nested = payload[path[0]]
        assert isinstance(nested, dict)
        target = nested
    else:
        target = payload
    target["unexpectedField"] = "must fail"

    with pytest.raises(ValidationError):
        EatbidIngestionAuctionV2.model_validate(payload)


def test_v2_generated_model이_v1_payload를_거부한다() -> None:
    with pytest.raises(ValidationError):
        EatbidIngestionAuctionV2.model_validate(golden_payload())
