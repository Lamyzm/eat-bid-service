"""참가제한지역 목록에 같은 지역 코드가 두 번 오면 같은 지역으로 합친다(ADR 0057).

운영에서 본 모양 그대로다: 기관이 시군구 하나를 먼저 고르고 "도 전체"를 다시 골라 같은 `PDLC_CD`가 두 줄
들어오고, 라벨은 `/` 앞뒤 공백만 다르다(2026-09 전남 공고 3건). 중복이 없는 공고의 바이트가 그대로인지는
`test_eat_normalize_v2.py`의 봉인 digest가 지킨다.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from eatbid.generated.ingestion_v2 import EatbidIngestionAuctionV2
from eatbid.source.eat.normalize import NormalizedDetail, normalize_bid_detail_payload

FIXTURE = Path(__file__).parents[1] / "fixtures" / "eat" / "bid-detail-roster.xml"

_FIRST_ROW = """      <Row>
        <Col id="CTPV_CD">15</Col>
        <Col id="SGG_CD">157</Col>
        <Col id="ELCTRN_BID_ID">5669410</Col>
        <Col id="ARA_SN">1</Col>
        <Col id="SGG_NM">창원</Col>
        <Col id="PDLC_NM">경남/창원시</Col>
        <Col id="PDLC_CD">15714</Col>
        <Col id="CTPV_NM">경남</Col>
      </Row>
"""


def _with_extra_area_row(*, code: str, label: str) -> bytes:
    text = FIXTURE.read_text(encoding="utf-8")
    assert _FIRST_ROW in text, "fixture의 지역 행 모양이 바뀌었다"
    extra = (
        _FIRST_ROW.replace('<Col id="ARA_SN">1</Col>', '<Col id="ARA_SN">2</Col>')
        .replace(
            '<Col id="PDLC_NM">경남/창원시</Col>', f'<Col id="PDLC_NM">{label}</Col>'
        )
        .replace('<Col id="PDLC_CD">15714</Col>', f'<Col id="PDLC_CD">{code}</Col>')
    )
    return text.replace(_FIRST_ROW, _FIRST_ROW + extra, 1).encode("utf-8")


def _codes(detail: NormalizedDetail) -> list[str]:
    return [code.root for code in detail.record.location.eligibility_codes]


@pytest.mark.parametrize("parser_version", ["eat-v2", "eat-v5"])
def test_같은_지역_코드가_두_줄이면_하나로_합치고_격리하지_않는다(
    parser_version: str,
) -> None:
    detail = normalize_bid_detail_payload(
        _with_extra_area_row(code="15714", label="경남 / 창원시"),
        external_bid_id="5669410",
        parser_version=parser_version,
    )

    assert isinstance(detail.record, EatbidIngestionAuctionV2)
    assert _codes(detail) == ["15714"]


def test_합칠_때는_첫_줄의_라벨을_남긴다() -> None:
    """두 라벨 모두 소스가 준 관측이다. 어느 쪽을 다듬어 고르지 않고 먼저 온 줄을 그대로 둔다."""
    detail = normalize_bid_detail_payload(
        _with_extra_area_row(code="15714", label="경남 / 창원시"),
        external_bid_id="5669410",
        parser_version="eat-v5",
    )

    areas = detail.record.location.eligibility_areas
    assert areas is not None
    assert [(area.code, area.label.root if area.label else None) for area in areas] == [
        ("15714", "경남/창원시")
    ]


def test_합친_사실은_조용히_사라지지_않고_관용_기록에_남는다() -> None:
    detail = normalize_bid_detail_payload(
        _with_extra_area_row(code="15714", label="경남 / 창원시"),
        external_bid_id="5669410",
        parser_version="eat-v5",
    )

    assert len(detail.tolerated) == 1
    assert "15714" in detail.tolerated[0]
    assert "ds_areaList" in detail.tolerated[0]


def test_서로_다른_지역_코드는_합치지_않고_모두_남긴다() -> None:
    detail = normalize_bid_detail_payload(
        _with_extra_area_row(code="15715", label="경남/김해시"),
        external_bid_id="5669410",
        parser_version="eat-v5",
    )

    assert _codes(detail) == ["15714", "15715"]
    assert detail.tolerated == ()
