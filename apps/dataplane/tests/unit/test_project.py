from __future__ import annotations

import pytest
from hypothesis import given
from hypothesis import strategies as st

from eatbid.core.models import AuctionProjection
from eatbid.core.repository import FrozenPublicationMember, ProjectionContractError
from eatbid.pipeline.project import (
    ProjectionFingerprintItem,
    build_eat_auction_projection,
    canonical_projection_fingerprint,
)

ITEMS = (
    ProjectionFingerprintItem("eat", "01", "a" * 64, "eat-v1", "b" * 64),
    ProjectionFingerprintItem("eat", "02", "c" * 64, "eat-v1", "d" * 64),
)
EXPECTED_FINGERPRINT = (
    "1875975d824d5ed54a1740ca089219e8712e5eb8fc9cc12a4c616c73f78e7041"
)


def test_auction_projection_contract가_필수_lineage_fields을_허용한다() -> None:
    projection = AuctionProjection(
        normalized_record_id=1,
        observation_id=2,
        source_system="eat",
        endpoint="bid-detail",
        parser_version="eat-v1",
        raw_content_sha256="a" * 64,
        normalized_payload_sha256="b" * 64,
        external_bid_id="bid-1",
        display_bid_no=None,
        organization_code="0001",
        organization_label="Observed name",
        code_refs=(),
        source_status="open",
        title="Lunch",
        announced_at=None,
        deadline_at=None,
        opened_at=None,
        base_amount=None,
        planned_amount=None,
        currency="KRW",
        source_payload={"external_bid_id": "bid-1"},
    )

    assert projection.normalized_record_id == 1


def test_projection_fingerprint는_order_독립적이다() -> None:
    assert canonical_projection_fingerprint(ITEMS) == EXPECTED_FINGERPRINT
    assert canonical_projection_fingerprint(tuple(reversed(ITEMS))) == (
        EXPECTED_FINGERPRINT
    )


@given(st.permutations(ITEMS))
def test_projection_fingerprint는_안정적_대상_모든_member_permutation이다(
    items: list[ProjectionFingerprintItem],
) -> None:
    assert canonical_projection_fingerprint(tuple(items)) == EXPECTED_FINGERPRINT


def auction_payload() -> dict[str, object]:
    return {
        "external_bid_id": "bid-1",
        "display_bid_no": None,
        "title": "Lunch",
        "source_status": "open",
        "organization_code": "0001",
        "organization_name": "Same Name",
        "sido_code": "01",
        "sigungu_code": "0110",
        "eligibility_codes": ["01", "02"],
        "announced_at": None,
        "deadline_at": None,
        "opened_at": None,
        "base_amount": None,
        "planned_amount": None,
        "currency": "KRW",
        "source_category_label": None,
        "category_source": "unknown",
    }


def frozen_member(**overrides: object) -> FrozenPublicationMember:
    values: dict[str, object] = {
        "normalized_record_id": 7,
        "observation_id": 9,
        "source_system": "eat",
        "endpoint": "bid-detail",
        "run_parser_version": "eat-v1",
        "record_type": "auction",
        "source_entity_id": "bid-1",
        "normalized_payload": auction_payload(),
        "parser_version": "eat-v1",
        "raw_content_sha256": "f" * 64,
    }
    values.update(overrides)
    return FrozenPublicationMember(**values)  # type: ignore[arg-type]


def test_projection_factory가_검토된_source_code_reference만_내보낸다() -> None:
    projection = build_eat_auction_projection(frozen_member())

    assert projection.normalized_payload_sha256 == (
        "3a9d779194e2cc2bcf81b564b3064b98d51bf149f37ab7eecfce78e10f45df21"
    )
    assert projection.organization_code == "0001"
    assert projection.organization_label == "Same Name"
    assert [
        (reference.namespace, reference.code, reference.role)
        for reference in projection.code_refs
    ] == [
        ("eat:auction-location-sido", "01", "location_sido"),
        ("eat:auction-location-sigungu", "0110", "location_sigungu"),
        ("eat:eligibility-area", "01", "eligibility_area"),
        ("eat:eligibility-area", "02", "eligibility_area"),
    ]


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"source_system": "neis"}, "source"),
        ({"endpoint": "bid-list"}, "endpoint"),
        ({"record_type": "organization"}, "record type"),
        ({"parser_version": "eat-v2"}, "parser version"),
        ({"raw_content_sha256": "F" * 64}, "raw content hash"),
        ({"source_entity_id": "different"}, "external ID"),
    ],
)
def test_projection_factory가_lineage_또는_source_contract_drift을_거부한다(
    overrides: dict[str, object], message: str
) -> None:
    with pytest.raises(ProjectionContractError, match=message):
        build_eat_auction_projection(frozen_member(**overrides))


def test_projection_factory가_알_수_없는_normalized_payload_fields을_거부한다() -> None:
    payload = auction_payload()
    payload["invented_school_type"] = "school"

    with pytest.raises(ProjectionContractError, match="normalized payload"):
        build_eat_auction_projection(frozen_member(normalized_payload=payload))


def test_projection_factory가_중복_eligibility_codes을_거부한다() -> None:
    payload = auction_payload()
    payload["eligibility_codes"] = ["01", "01"]

    with pytest.raises(ProjectionContractError, match="duplicate eligibility"):
        build_eat_auction_projection(frozen_member(normalized_payload=payload))
