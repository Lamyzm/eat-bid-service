from __future__ import annotations

from hashlib import sha256
from pathlib import Path

import pytest

from eatbid.failures.errors import SourceContractError
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


# EAT-75 직전(f70271e)의 eat-v2 파서가 같은 fixture에서 낸 canonical payload의 digest다. eat-v3가 라벨을
# 싣기 시작해도 eat-v2의 바이트는 그대로여야 한다 — `ingest.normalized_record`가 같은 parser version
# 키에 다른 payload를 비결정으로 거부하기 때문이다(ADR 0038). 값을 갱신해야 한다고 느껴지면 그건 새
# parser version이 필요한 변경이다.
_SEALED_V2_PAYLOAD_DIGESTS = {
    "bid-detail-one.xml": (
        "0a80eea6bd640d3aef41ab865b96a803ad85f282a07783bb79442ec0e780414e"
    ),
    "bid-detail-roster.xml": (
        "f7c7d5e8bf962fa938f5ab5b004af0ba87658e3ca88201cc862f9abe75710a19"
    ),
    "bid-detail-rebid.xml": (
        "cb60bf647c51bee5dc053007c24862113da9b292f1d7b04a1bb4b36caa7118fd"
    ),
    "bid-detail-no-roster.xml": (
        "0a80eea6bd640d3aef41ab865b96a803ad85f282a07783bb79442ec0e780414e"
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


@pytest.mark.parametrize("fixture", sorted(_SEALED_V2_PAYLOAD_DIGESTS))
def test_v3_경로가_생겨도_v2_canonical_payload_바이트가_그대로다(fixture: str) -> None:
    record = normalize_bid_detail(
        _payload(fixture), external_bid_id="5669410", parser_version="eat-v2"
    )

    assert isinstance(record, EatbidIngestionAuctionV2)
    assert record.location.eligibility_areas is None
    assert b"eligibilityAreas" not in canonical_payload(record)
    assert sha256(canonical_payload(record)).hexdigest() == _SEALED_V2_PAYLOAD_DIGESTS[fixture]


def test_eat_v3는_참가제한지역_라벨을_코드와_같은_순서로_원문_그대로_싣는다() -> None:
    record = normalize_bid_detail(
        _payload("bid-detail-roster.xml"),
        external_bid_id="5669410",
        parser_version="eat-v2",
    )
    labelled = normalize_bid_detail(
        _payload("bid-detail-roster.xml"),
        external_bid_id="5669410",
        parser_version="eat-v3",
    )

    assert isinstance(record, EatbidIngestionAuctionV2)
    assert isinstance(labelled, EatbidIngestionAuctionV2)
    # 같은 계약, 같은 record type이다. 라벨은 새 root가 아니라 가산 필드다(ADR 0038).
    assert labelled.contract_version == record.contract_version
    areas = labelled.location.eligibility_areas
    assert areas is not None
    assert [area.code for area in areas] == [
        code.root for code in labelled.location.eligibility_codes
    ] == ["15714"]
    assert [area.code_scheme for area in areas] == ["eat:eligibility-area"]
    assert [area.label.root if area.label else None for area in areas] == ["경남/창원시"]
    # 라벨 키 하나만 다르고 나머지 바이트는 v2와 같다.
    v3_bytes = canonical_payload(labelled)
    area_key = (
        '"eligibilityAreas":[{"code":"15714","codeScheme":"eat:eligibility-area",'
        '"label":"경남/창원시","sourceSystem":"eat"}],'
    ).encode()
    assert area_key in v3_bytes
    assert v3_bytes.replace(area_key, b"") == canonical_payload(record)


def test_eat_v3는_참가제한지역이_없는_상세에_빈_라벨_목록을_명시한다() -> None:
    """키 없음(라벨을 보지 않은 version)과 빈 목록(지역이 없는 공고)은 다른 사실이다."""
    body = (
        (FIXTURES / "bid-detail-one.xml")
        .read_text(encoding="utf-8")
        .replace('<Rows><Row><Col id="PDLC_CD">15653</Col></Row></Rows>', "<Rows></Rows>", 1)
        .encode("utf-8")
    )

    record = normalize_bid_detail(body, external_bid_id="1", parser_version="eat-v3")

    assert isinstance(record, EatbidIngestionAuctionV2)
    assert record.location.eligibility_codes == []
    assert record.location.eligibility_areas == []
    assert b'"eligibilityAreas":[]' in canonical_payload(record)


def test_eat_v3는_라벨_column이_없는_원본에서도_코드만_싣고_격리하지_않는다() -> None:
    """`bid-detail-one.xml`은 `PDLC_NM` column 자체가 없는 아카이브 모양이다. 라벨은 선택 column이다."""
    record = normalize_bid_detail(
        _payload("bid-detail-one.xml"), external_bid_id="1", parser_version="eat-v3"
    )

    assert isinstance(record, EatbidIngestionAuctionV2)
    assert record.location.eligibility_areas is not None
    assert [(area.code, area.label) for area in record.location.eligibility_areas] == [
        ("15653", None)
    ]


def test_eat_v3는_라벨이_비어_있어도_코드만_남기고_격리하지_않는다() -> None:
    body = (
        (FIXTURES / "bid-detail-roster.xml")
        .read_text(encoding="utf-8")
        .replace('<Col id="PDLC_NM">경남/창원시</Col>', '<Col id="PDLC_NM"></Col>', 1)
        .encode("utf-8")
    )

    record = normalize_bid_detail(body, external_bid_id="5669410", parser_version="eat-v3")

    assert isinstance(record, EatbidIngestionAuctionV2)
    assert record.location.eligibility_areas is not None
    assert record.location.eligibility_areas[0].code == "15714"
    assert record.location.eligibility_areas[0].label is None


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
