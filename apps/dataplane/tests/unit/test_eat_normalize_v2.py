from __future__ import annotations

from hashlib import sha256
from pathlib import Path

import pytest

from eatbid.errors import SourceContractError
from eatbid.generated.ingestion_v2 import EatbidIngestionAuctionV2
from eatbid.source.eat.normalize import (
    EatDetailValidationError,
    canonical_payload,
    normalize_bid_detail,
    normalize_bid_detail_payload,
)

FIXTURES = Path(__file__).parents[1] / "fixtures" / "eat"

# aad8005(Task 4 완료 시점)의 파서가 같은 fixture에서 낸 canonical payload의 digest다. eat-v2 경로가
# 생겨도 v1 발행물의 바이트는 움직이면 안 된다 — 봉인된 발행 구성원의 재직렬화 비교가 전부 어긋난다
# (ADR 0025). 값을 갱신해야 한다고 느껴지면 그건 v1 계약 변경이므로 ADR이 먼저다.
_SEALED_V1_PAYLOAD_DIGESTS = {
    "bid-detail-one.xml": (
        "ea41fcc190e3f421ed02e5c30d12389b0b323be026d0e739fd8dc5a9a7cecf7a"
    ),
    "bid-detail-roster.xml": (
        "32ad7272dfab4c4b7161e738ec3f15fa24835c0f468d3537df24a9d28bec2115"
    ),
    "bid-detail-rebid.xml": (
        "f0e2967e60ea302d7a7ab4fed2be310db8fe6529e0a9eb26a69060fe25d5053b"
    ),
    "bid-detail-no-roster.xml": (
        "ea41fcc190e3f421ed02e5c30d12389b0b323be026d0e739fd8dc5a9a7cecf7a"
    ),
}


def _payload(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


def test_v2_정규화가_명단과_추첨과_하한율을_한_record로_묶는다() -> None:
    detail = normalize_bid_detail_payload(
        _payload("bid-detail-roster.xml"),
        external_bid_id="5669410",
        parser_version="eat-v2",
    )

    record = detail.record
    assert isinstance(record, EatbidIngestionAuctionV2)
    assert record.contract_version == "eatbid.ingestion.auction.v2"
    assert len(record.roster.submissions) == 7
    assert record.award is not None
    assert record.award.awarded_rate.value == "90.218"
    assert record.terms.floor_rate is not None
    assert record.terms.floor_rate.value == "90.000"
    assert len(record.reserve_price_draw.candidates) == 15
    assert record.pricing.planned_amount is not None
    assert record.pricing.planned_amount.amount == "6762461.00"


def test_v1과_v2가_같은_원본에서_서로_다른_계약_버전을_낸다() -> None:
    payload = _payload("bid-detail-roster.xml")

    first = normalize_bid_detail_payload(
        payload, external_bid_id="5669410", parser_version="eat-v1"
    )
    second = normalize_bid_detail_payload(
        payload, external_bid_id="5669410", parser_version="eat-v2"
    )

    assert first.record.contract_version == "eatbid.ingestion.auction.v1"
    assert second.record.contract_version == "eatbid.ingestion.auction.v2"
    assert first.schema_fingerprint == second.schema_fingerprint
    assert not hasattr(first.record, "roster")


def test_재입찰_상세가_사슬_세_단계와_철회_행을_함께_싣는다() -> None:
    record = normalize_bid_detail(
        _payload("bid-detail-rebid.xml"),
        external_bid_id="5306521",
        parser_version="eat-v2",
    )

    assert isinstance(record, EatbidIngestionAuctionV2)
    assert record.lineage.parent_external_bid_id is not None
    assert record.lineage.parent_external_bid_id.root == "5306354"
    assert [link.external_bid_id for link in record.lineage.links] == [
        "5306521",
        "5306354",
        "5301243",
    ]
    withdrawn = record.roster.submissions[1]
    assert withdrawn.withdrawal_flag is not None
    assert withdrawn.withdrawal_flag.code == "Y"
    assert withdrawn.bid_rate.value == "89.626"
    assert record.award is not None
    assert record.award.awarded_rate.value == "90.272"


def test_블록이_없는_상세도_v2로_정규화되고_격리되지_않는다() -> None:
    record = normalize_bid_detail(
        _payload("bid-detail-no-roster.xml"),
        external_bid_id="1",
        parser_version="eat-v2",
    )

    assert isinstance(record, EatbidIngestionAuctionV2)
    assert record.roster.submissions == []
    assert record.roster.source_roster_size is None
    assert record.award is None
    assert record.lineage.links == []
    assert record.reserve_price_draw.candidates == []
    assert record.terms.floor_rate is None


def test_명단_행이_깨지면_그_관측만_격리_대상_오류가_된다() -> None:
    broken = (
        (FIXTURES / "bid-detail-roster.xml")
        .read_text(encoding="utf-8")
        .replace(
            '<Col id="SAJEONG_PCT">90.218</Col>',
            '<Col id="SAJEONG_PCT">구십</Col>',
            1,
        )
        .encode("utf-8")
    )

    with pytest.raises(EatDetailValidationError) as error:
        normalize_bid_detail_payload(
            broken, external_bid_id="5669410", parser_version="eat-v2"
        )

    assert error.value.schema_fingerprint is not None
    assert "SAJEONG_PCT" in str(error.value)


def test_검토되지_않은_parser_version은_상세를_해석하지_않는다() -> None:
    with pytest.raises(SourceContractError, match="unknown-parser-version"):
        normalize_bid_detail_payload(
            _payload("bid-detail-roster.xml"),
            external_bid_id="5669410",
            parser_version="eat-v9",
        )


def test_canonical_payload는_v2_record도_정렬된_바이트로_직렬화한다() -> None:
    record = normalize_bid_detail(
        _payload("bid-detail-roster.xml"),
        external_bid_id="5669410",
        parser_version="eat-v2",
    )

    first = canonical_payload(record)

    assert canonical_payload(record) == first
    assert b'"contractVersion":"eatbid.ingestion.auction.v2"' in first
    assert first.startswith(b'{"award":')


@pytest.mark.parametrize("fixture", sorted(_SEALED_V1_PAYLOAD_DIGESTS))
def test_v2_경로가_생겨도_v1_canonical_payload_바이트가_그대로다(
    fixture: str,
) -> None:
    record = normalize_bid_detail(
        _payload(fixture), external_bid_id="5669410", parser_version="eat-v1"
    )

    digest = sha256(canonical_payload(record)).hexdigest()

    assert digest == _SEALED_V1_PAYLOAD_DIGESTS[fixture]


def test_v1_canonical_payload가_봉인된_바이트를_그대로_낸다() -> None:
    record = normalize_bid_detail(
        _payload("bid-detail-one.xml"),
        external_bid_id="5669410",
        parser_version="eat-v1",
    )

    assert canonical_payload(record) == (
        '{"buyer":{"organizationCode":"153347","organizationName":"비식별 구매기관"},'
        '"classification":{"categorySource":"source_field",'
        '"sourceCategoryLabel":"원본 분류 라벨"},'
        '"contractVersion":"eatbid.ingestion.auction.v1",'
        '"identity":{"displayBidNumber":"E250617-472599-1",'
        '"externalBidId":"5669410","status":"완료",'
        '"title":"비식별 급식 식재료 구매"},'
        '"location":{"eligibilityCodes":["15653"],"sidoCode":"15",'
        '"sigunguCode":"653"},'
        '"pricing":{"baseAmount":{"amount":"10000000.00","currency":"KRW"},'
        '"plannedAmount":{"amount":"9990000.00","currency":"KRW"}},'
        '"schedule":{"announcedAt":"2025-06-16T15:00:00Z",'
        '"deadlineAt":"2025-06-19T06:00:00Z",'
        '"openedAt":"2025-06-20T01:30:00Z"}}'
    ).encode()
