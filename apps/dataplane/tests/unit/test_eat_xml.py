from __future__ import annotations

from pathlib import Path

import pytest

from eatbid.errors import SourceContractError
from eatbid.source.eat.normalize import parse_bid_list_page
from eatbid.source.eat.schema_contract import (
    reviewed_schema_fingerprint,
    validate_eat_schema_contract,
)
from eatbid.source.eat.xml import NexacroParseError, parse_nexacro

FIXTURE_DIR = Path(__file__).parents[1] / "fixtures" / "eat"
NS = "http://www.nexacroplatform.com/platform/dataset"


def xml(body: str) -> bytes:
    return f'<Root xmlns="{NS}">{body}</Root>'.encode()


def test_parse_bid_list_page가_total과_internal_ID를_보존한다() -> None:
    page = parse_bid_list_page((FIXTURE_DIR / "bid-list-one.xml").read_bytes())

    assert page.total_count == 1
    assert page.external_bid_ids == ("5610615",)


@pytest.mark.parametrize("total", ["", "-1", "+1", "1.0", "１２"])
def test_parse_bid_list_page가_음수가_아닌_ascii_decimal_contract을_거부한다(
    total: str,
) -> None:
    payload = xml(
        f'<Dataset id="ds_list"><Rows><Row><Col id="TOT_CNT">{total}</Col>'
        '<Col id="ETN_BID_ID">1</Col></Row></Rows></Dataset>'
    )

    with pytest.raises(SourceContractError):
        parse_bid_list_page(payload)


@pytest.mark.parametrize(
    "rows",
    [
        '<Row><Col id="TOT_CNT">2</Col><Col id="ETN_BID_ID"></Col></Row>',
        (
            '<Row><Col id="TOT_CNT">2</Col><Col id="ETN_BID_ID">1</Col></Row>'
            '<Row><Col id="TOT_CNT">2</Col><Col id="ETN_BID_ID">1</Col></Row>'
        ),
        (
            '<Row><Col id="TOT_CNT">1</Col><Col id="ETN_BID_ID">1</Col></Row>'
            '<Row><Col id="TOT_CNT">1</Col><Col id="ETN_BID_ID">2</Col></Row>'
        ),
    ],
)
def test_parse_bid_list_page가_empty_중복_또는_excess_ids을_거부한다(rows: str) -> None:
    with pytest.raises(SourceContractError):
        parse_bid_list_page(xml(f'<Dataset id="ds_list"><Rows>{rows}</Rows></Dataset>'))


@pytest.mark.parametrize(
    "payload",
    [
        b'<!DOCTYPE Root [<!ELEMENT Root ANY>]><Root/>',
        b'<!DOCTYPE Root [<!ENTITY x "expanded">]><Root>&x;</Root>',
        b'<!DOCTYPE Root SYSTEM "https://invalid.example/evil.dtd"><Root/>',
    ],
)
def test_신뢰하지_않는_XML은_DTD_entity와_external_reference를_거부한다(
    payload: bytes,
) -> None:
    with pytest.raises(NexacroParseError):
        parse_nexacro(payload)


@pytest.mark.parametrize(
    "body",
    [
        '<Dataset id="ds_x"/><Dataset id="ds_x"/>',
        (
            '<Dataset id="ds_info"><Rows><Row>'
            '<Col id="A">1</Col><Col id="A">2</Col>'
            '</Row></Rows></Dataset>'
        ),
        '<Dataset id="ds_info"><Rows><Row><Col>1</Col></Row></Rows></Dataset>',
        '<Dataset id="ds_info"><Rows/></Dataset>',
        (
            '<Dataset id="ds_info"><Rows><Row/><Row/></Rows></Dataset>'
        ),
    ],
)
def test_parser가_중복_또는_ambiguous_nexacro_structure을_거부한다(body: str) -> None:
    with pytest.raises(NexacroParseError):
        parse_nexacro(xml(body), require_ds_info=True)


def test_schema_fingerprint는_dataset과_column_순서에_독립적이다() -> None:
    first = xml(
        '<Dataset id="ds_info"><Rows><Row><Col id="B">2</Col>'
        '<Col id="A">1</Col></Row></Rows></Dataset>'
        '<Dataset id="ds_areaList"><Rows><Row><Col id="PDLC_CD">01</Col>'
        '</Row></Rows></Dataset>'
    )
    second = xml(
        '<Dataset id="ds_areaList"><Rows><Row><Col id="PDLC_CD">99</Col>'
        '</Row></Rows></Dataset>'
        '<Dataset id="ds_info"><Rows><Row><Col id="A">x</Col>'
        '<Col id="B">y</Col></Row></Rows></Dataset>'
    )

    assert parse_nexacro(first, require_ds_info=True).schema_fingerprint == parse_nexacro(
        second, require_ds_info=True
    ).schema_fingerprint


def test_parser가_nexacro_namespace을_요구한다() -> None:
    with pytest.raises(NexacroParseError):
        parse_nexacro(b"<Root><Dataset id='ds_info'><Rows><Row/></Rows></Dataset></Root>")


def test_reviewed_eat_detail_schema_contract는_안정적_parser_digest을_갖는다() -> None:
    assert reviewed_schema_fingerprint(
        source="eat", endpoint="bid-detail", parser_version="eat-v1"
    ) == "c5270779844ac60244d94d852db2547cd42c47548dd4189d55f8f7a4e3c94adf"
    assert validate_eat_schema_contract(
        source="eat",
        endpoint="bid-detail",
        parser_version="eat-v1",
        schema_fingerprint="c5270779844ac60244d94d852db2547cd42c47548dd4189d55f8f7a4e3c94adf",
    )


@pytest.mark.parametrize(
    ("source", "endpoint", "parser_version", "schema_fingerprint"),
    [
        ("eat", "bid-detail", "eat-v1", "0" * 64),
        ("eat", "unreviewed-detail", "eat-v1", "c5270779844ac60244d94d852db2547cd42c47548dd4189d55f8f7a4e3c94adf"),
        ("eat", "bid-detail", "eat-v2", "c5270779844ac60244d94d852db2547cd42c47548dd4189d55f8f7a4e3c94adf"),
    ],
)
def test_eat_schema_contract가_fail_closed한다(
    source: str,
    endpoint: str,
    parser_version: str,
    schema_fingerprint: str,
) -> None:
    assert not validate_eat_schema_contract(
        source=source,
        endpoint=endpoint,
        parser_version=parser_version,
        schema_fingerprint=schema_fingerprint,
    )


def _nexacro(inner: str) -> bytes:
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<Root xmlns="http://www.nexacroplatform.com/platform/dataset">'
        '<Dataset id="ds_info"><ColumnInfo>'
        '<Column id="DLVRY_PLACE" type="STRING"/></ColumnInfo>'
        f"<Rows><Row><Col id=\"DLVRY_PLACE\">{inner}</Col></Row></Rows>"
        "</Dataset></Root>"
    ).encode()


@pytest.mark.parametrize(
    ("wire", "expected"),
    [
        # 2026-09-03 실측: 학교 이름에 든 &를 소스가 이스케이프하지 않고 그대로 보낸다.
        ("협성고등학교&협성경복중학교 공동 급식실", "협성고등학교&협성경복중학교 공동 급식실"),
        ("a&b&c", "a&b&c"),
        ("정상 &amp; 이스케이프", "정상 & 이스케이프"),
        ("숫자 참조 &#65;", "숫자 참조 A"),
        ("십육진 참조 &#x42;", "십육진 참조 B"),
        ("&amp;amp;", "&amp;"),
    ],
)
def test_이스케이프되지_않은_ampersand를_복구해_해석한다(
    wire: str, expected: str
) -> None:
    parsed = parse_nexacro(_nexacro(wire), require_ds_info=True)

    assert parsed.datasets["ds_info"][0]["DLVRY_PLACE"] == expected


def test_ampersand_복구는_DTD와_entity_공격을_계속_막는다() -> None:
    attack = (
        b'<?xml version="1.0"?><!DOCTYPE Root [<!ENTITY x "boom">]>'
        b'<Root xmlns="http://www.nexacroplatform.com/platform/dataset">'
        b'<Dataset id="ds_info"><Rows><Row><Col id="A">&x;</Col></Row></Rows>'
        b"</Dataset></Root>"
    )

    with pytest.raises(NexacroParseError):
        parse_nexacro(attack, require_ds_info=True)
