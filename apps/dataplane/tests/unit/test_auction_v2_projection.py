"""eat-v2 발행 구성원을 core 투영으로 옮기는 빌더의 단위 명세.

정규화 payload는 저장소 fixture를 실제 파서로 통과시켜 만든다. 손으로 적은 JSON은 계약이 바뀐 날
같이 틀리지 않아 "계약을 통과한 관측"을 대신하지 못한다.
"""

from __future__ import annotations

import json
from decimal import Decimal
from pathlib import Path

import pytest

from eatbid.core.auction_v2_projection import build_eat_auction_v2_projection
from eatbid.core.projection_models import (
    AWARDED_STATUS_CODE,
    CHAIN_MEMBER_RELATION,
    PARENT_RELATION,
)
from eatbid.core.projection_validation import validate_projection
from eatbid.core.repository import FrozenPublicationMember, ProjectionContractError
from eatbid.source.eat.code_schemes import (
    ATTEMPT_STATUS,
    AWARD_METHOD,
    BID_STATUS,
    BUSINESS_NUMBER,
    ELIGIBILITY_AREA,
    PLANNED_PRICE_TYPE,
    SUPPLIER_ACCOUNT,
)
from eatbid.source.eat.normalize import canonical_payload, normalize_bid_detail_payload

FIXTURES = Path(__file__).parents[1] / "fixtures" / "eat"
ROSTER_BID_ID = "5669410"
REBID_BID_ID = "5669411"


def normalized_payload(
    fixture: str, external_bid_id: str, *, parser_version: str = "eat-v2"
) -> dict[str, object]:
    record = normalize_bid_detail_payload(
        (FIXTURES / fixture).read_bytes(),
        external_bid_id=external_bid_id,
        parser_version=parser_version,
    ).record
    return json.loads(canonical_payload(record))


def labelled_member(**overrides: object) -> FrozenPublicationMember:
    """eat-v3 run이 봉인한 구성원이다. record type은 eat-v2와 같은 `auction.v2`다."""
    values: dict[str, object] = {
        "run_parser_version": "eat-v3",
        "parser_version": "eat-v3",
        "normalized_payload": normalized_payload(
            "bid-detail-roster.xml", ROSTER_BID_ID, parser_version="eat-v3"
        ),
    }
    values.update(overrides)
    return frozen_member(**values)


def _eligibility_refs(projection) -> list[tuple[str, str | None]]:
    return [
        (reference.code, reference.label)
        for reference in projection.code_refs
        if reference.namespace == ELIGIBILITY_AREA.namespace
    ]


def _with_areas(payload: dict[str, object], areas: object) -> dict[str, object]:
    location = payload["location"]
    assert isinstance(location, dict)
    return {**payload, "location": {**location, "eligibilityAreas": areas}}


def frozen_member(**overrides: object) -> FrozenPublicationMember:
    values: dict[str, object] = {
        "normalized_record_id": 7,
        "observation_id": 9,
        "source_system": "eat",
        "endpoint": "bid-detail",
        "run_parser_version": "eat-v2",
        "record_type": "auction.v2",
        "source_entity_id": ROSTER_BID_ID,
        "normalized_payload": normalized_payload(
            "bid-detail-roster.xml", ROSTER_BID_ID
        ),
        "parser_version": "eat-v2",
        "raw_content_sha256": "f" * 64,
    }
    values.update(overrides)
    return FrozenPublicationMember(**values)  # type: ignore[arg-type]


def with_roster_row(index: int, **changes: object) -> dict[str, object]:
    """관측 하나만 바꾼 payload를 만든다. 계약을 통과한 모양을 유지한 채 값만 흔든다."""
    payload = normalized_payload("bid-detail-roster.xml", ROSTER_BID_ID)
    roster = payload["roster"]
    assert isinstance(roster, dict)
    submissions = roster["submissions"]
    assert isinstance(submissions, list)
    submissions[index] = {**submissions[index], **changes}
    return payload


def test_eat_v3_구성원은_참가제한지역_코드에_관측_라벨을_붙여_옮긴다() -> None:
    projection = build_eat_auction_v2_projection(labelled_member())
    validate_projection(projection)

    assert _eligibility_refs(projection) == [("15714", "경남/창원시")]
    # 봉인된 payload가 되읽기에서도 canonical이다. source_payload도 producer가 쓴 키만 싣는다.
    assert "eligibilityAreas" in projection.source_payload["location"]  # type: ignore[index]


def test_라벨_이전_v2_구성원은_라벨_없이_그대로_투영된다() -> None:
    """이미 봉인된 eat-v2 발행물은 새 키를 모른다. 그것을 canonical 위반으로 읽으면 과거 발행이 전부 끊긴다."""
    projection = build_eat_auction_v2_projection(frozen_member())
    validate_projection(projection)

    assert _eligibility_refs(projection) == [("15714", None)]
    assert "eligibilityAreas" not in projection.source_payload["location"]  # type: ignore[index]


def test_라벨_목록이_코드_목록과_어긋나면_투영하지_않고_끊는다() -> None:
    payload = normalized_payload(
        "bid-detail-roster.xml", ROSTER_BID_ID, parser_version="eat-v3"
    )
    area = {
        "sourceSystem": "eat",
        "codeScheme": ELIGIBILITY_AREA.namespace,
        "code": "15714",
        "label": "경남/창원시",
    }
    candidates = [
        _with_areas(payload, []),
        _with_areas(payload, [{**area, "code": "15715"}]),
        _with_areas(payload, [area, area]),
        _with_areas(payload, [{**area, "codeScheme": BID_STATUS.namespace}]),
        _with_areas(payload, [{**area, "sourceSystem": "nara"}]),
    ]

    for candidate in candidates:
        with pytest.raises(ProjectionContractError):
            build_eat_auction_v2_projection(labelled_member(normalized_payload=candidate))


def test_라벨이_비어_있는_행은_코드만_옮기고_격리하지_않는다() -> None:
    payload = normalized_payload(
        "bid-detail-roster.xml", ROSTER_BID_ID, parser_version="eat-v3"
    )
    payload = _with_areas(
        payload,
        [
            {
                "sourceSystem": "eat",
                "codeScheme": ELIGIBILITY_AREA.namespace,
                "code": "15714",
                "label": None,
            }
        ],
    )

    projection = build_eat_auction_v2_projection(
        labelled_member(normalized_payload=payload)
    )
    validate_projection(projection)

    assert _eligibility_refs(projection) == [("15714", None)]


def test_명단_행을_관측_순서_그대로_옮긴다() -> None:
    projection = build_eat_auction_v2_projection(frozen_member())

    submissions = projection.roster.submissions
    assert len(submissions) == 7
    assert [item.roster_ordinal for item in submissions] == list(range(7))
    assert [str(item.bid_rate) for item in submissions] == [
        "90.218",
        "90.382",
        "90.512",
        "90.567",
        "90.614",
        "90.748",
        "90.557",
    ]
    assert submissions[0].supplier.account.namespace == SUPPLIER_ACCOUNT.namespace
    assert submissions[0].supplier.account.code == "200000"
    assert submissions[0].supplier.business_number is not None
    assert submissions[0].supplier.business_number.namespace == BUSINESS_NUMBER.namespace
    assert submissions[0].draw_numbers == ("7", "3")
    assert submissions[0].currency == "KRW"
    assert submissions[0].amount == Decimal("6101000.00")


def test_사정률_100_초과_행을_격리하지_않는다() -> None:
    payload = with_roster_row(
        1, bidRate={"unit": "percentage-points", "value": "144477738.050"}
    )

    projection = build_eat_auction_v2_projection(
        frozen_member(normalized_payload=payload)
    )
    validate_projection(projection)

    assert projection.roster.submissions[1].bid_rate == Decimal("144477738.050")


def test_낙찰_판정_코드를_파생_상태로_바꾸지_않는다() -> None:
    projection = build_eat_auction_v2_projection(frozen_member())

    award = projection.award
    assert award is not None
    assert award.source_status.namespace == BID_STATUS.namespace
    assert award.source_status.code == AWARDED_STATUS_CODE
    assert award.awarded_roster_ordinal == 0
    assert award.awarded_rate == Decimal("90.218")
    assert award.runner_up_rate == Decimal("90.382")
    # 승패·무효·하한 미달을 뜻하는 필드가 투영에 없다. 판정은 코드 하나뿐이다(AGENTS 8).
    assert not [
        name
        for name in dir(award)
        if any(word in name for word in ("won", "invalid", "floor"))
    ]


def test_공고_조건을_하한율_열과_검토된_코드_role로_옮긴다() -> None:
    projection = build_eat_auction_v2_projection(frozen_member())
    validate_projection(projection)

    assert projection.floor_rate == Decimal("90.000")
    assert [
        (reference.namespace, reference.code, reference.role)
        for reference in projection.code_refs
        if reference.role in {"award_method", "planned_price_method"}
    ] == [
        (PLANNED_PRICE_TYPE.namespace, "002", "planned_price_method"),
        (AWARD_METHOD.namespace, "003", "award_method"),
    ]


def test_공고_조건이_관측되지_않으면_비운다() -> None:
    """관측하지 못한 조건을 기본값으로 메우면 코호트 키가 조용히 거짓이 된다(AGENTS 3)."""
    payload = normalized_payload("bid-detail-roster.xml", ROSTER_BID_ID)
    payload["terms"] = {
        "floorRate": None,
        "plannedPriceMethod": None,
        "awardMethod": None,
    }

    projection = build_eat_auction_v2_projection(
        frozen_member(normalized_payload=payload)
    )
    validate_projection(projection)

    assert projection.floor_rate is None
    assert not [
        reference
        for reference in projection.code_refs
        if reference.role in {"award_method", "planned_price_method"}
    ]


def test_공고_조건_코드의_체계가_바뀌면_투영하지_않고_끊는다() -> None:
    """role은 우리가 붙이고 체계는 관측이 준다. 둘이 어긋나면 조용히 라벨을 바꾸지 않는다."""
    payload = normalized_payload("bid-detail-roster.xml", ROSTER_BID_ID)
    terms = payload["terms"]
    assert isinstance(terms, dict)
    award_method = terms["awardMethod"]
    assert isinstance(award_method, dict)
    payload["terms"] = {
        **terms,
        "awardMethod": {**award_method, "codeScheme": "eat:bid-status"},
    }

    projection = build_eat_auction_v2_projection(
        frozen_member(normalized_payload=payload)
    )

    with pytest.raises(ProjectionContractError, match="not reviewed"):
        validate_projection(projection)


def test_사업자번호가_없는_명단_행은_업체_정체성_없이_투영된다() -> None:
    payload = with_roster_row(2, supplierAccount=_account_without_business_number())

    projection = build_eat_auction_v2_projection(
        frozen_member(normalized_payload=payload)
    )
    validate_projection(projection)

    assert projection.roster.submissions[2].supplier.business_number is None
    assert projection.roster.submissions[2].supplier.account.code == "200002"


def test_재입찰_사슬은_상대_공고를_외부_id로만_싣는다() -> None:
    projection = build_eat_auction_v2_projection(
        frozen_member(
            source_entity_id=REBID_BID_ID,
            normalized_payload=normalized_payload(
                "bid-detail-rebid.xml", REBID_BID_ID
            ),
        )
    )
    validate_projection(projection)

    links = projection.attempt_links
    assert links, "재입찰 fixture는 사슬 관계를 하나 이상 관측한다"
    assert {link.relation for link in links} <= {PARENT_RELATION, CHAIN_MEMBER_RELATION}
    for link in links:
        assert link.to_external_bid_id
        if link.source_status is not None:
            assert link.source_status.namespace == ATTEMPT_STATUS.namespace
        if link.base_amount is not None or link.planned_amount is not None:
            assert link.currency == "KRW"


def test_낙찰_행이_둘이면_투영하지_않고_끊는다() -> None:
    payload = with_roster_row(
        1,
        sourceStatus={
            "code": AWARDED_STATUS_CODE,
            "codeScheme": BID_STATUS.namespace,
            "label": None,
            "sourceSystem": "eat",
        },
    )

    with pytest.raises(ProjectionContractError):
        build_eat_auction_v2_projection(frozen_member(normalized_payload=payload))


def _account_without_business_number() -> dict[str, object]:
    return {
        "accountCode": {
            "code": "200002",
            "codeScheme": SUPPLIER_ACCOUNT.namespace,
            "label": None,
            "sourceSystem": "eat",
        },
        "businessNumber": None,
        "sourceSystem": "eat",
    }
