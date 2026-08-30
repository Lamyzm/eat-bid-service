from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from eatbid.generated import EatbidIngestionAuctionV1

FIXTURE = (
    Path(__file__).parents[4]
    / "packages"
    / "contracts"
    / "fixtures"
    / "ingestion-v1"
    / "normalized-auction.json"
)


def golden_payload() -> dict[str, object]:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


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
