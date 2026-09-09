from __future__ import annotations

from pathlib import Path

import pytest

from eatbid.failures.errors import SourceContractError
from eatbid.source.eat.bid_list import parse_bid_list_page
from eatbid.source.eat.schema_contract import (
    reviewed_schema_contract,
    reviewed_schema_fingerprint,
    validate_eat_schema_contract,
)
from eatbid.source.eat.xml import NexacroParseError, parse_nexacro

FIXTURE_DIR = Path(__file__).parents[1] / "fixtures" / "eat"
NS = "http://www.nexacroplatform.com/platform/dataset"


def xml(body: str) -> bytes:
    return f'<Root xmlns="{NS}">{body}</Root>'.encode()


def list_row(total: str, bid_id: str, **overrides: str | None) -> str:
    """검토된 필수 column 여섯을 갖춘 목록 행이다. override 값이 None이면 그 column을 뺀다."""
    columns: dict[str, str | None] = {
        "TOT_CNT": total,
        "ETN_BID_ID": bid_id,
        "BID_CNT": "1",
        "ETN_BID_STT_NM": "진행중",
        "BID_END_DT": "20260914100000000",
        "LAST_CHG_DT": "20260902175956000",
    }
    columns.update(overrides)
    cells = "".join(
        f'<Col id="{name}">{value}</Col>'
        for name, value in columns.items()
        if value is not None
    )
    return f"<Row>{cells}</Row>"


def list_page(*rows: str) -> bytes:
    return xml(f'<Dataset id="ds_list"><Rows>{"".join(rows)}</Rows></Dataset>')


def test_parse_bid_list_page가_total과_internal_ID를_보존한다() -> None:
    page = parse_bid_list_page(
        (FIXTURE_DIR / "bid-list-one.xml").read_bytes(), parser_version="eat-v1"
    )

    assert page.total_count == 1
    assert page.external_bid_ids == ("5610615",)
    (row,) = page.rows
    assert row.competitor_count == 0
    assert row.status_name == "입찰공고"
    assert row.deadline_at.root == "2026-09-14T01:00:00Z"
    assert row.last_changed_at.root == "2026-09-02T08:59:56Z"
    assert row.base_amount is not None
    assert (row.base_amount.amount, row.base_amount.currency) == ("69000000.00", "KRW")
    assert row.planned_price_type_name == "복수예정가격"
    assert row.buyer_organization_code is not None
    assert row.buyer_organization_code.root == "199148"
    assert row.buyer_organization_name == "선양시니어빌리지"
    assert row.award_method_name == "예정가격의 []%이상 입찰가 중 최저가 낙찰"


@pytest.mark.parametrize("total", ["", "-1", "+1", "1.0", "１２"])
def test_parse_bid_list_page가_음수가_아닌_ascii_decimal_contract을_거부한다(
    total: str,
) -> None:
    payload = list_page(list_row(total, "1"))

    with pytest.raises(SourceContractError):
        parse_bid_list_page(payload, parser_version="eat-v1")


@pytest.mark.parametrize(
    "rows",
    [
        list_row("2", ""),
        list_row("2", "1") + list_row("2", "1"),
        list_row("1", "1") + list_row("1", "2"),
    ],
)
def test_parse_bid_list_page가_empty_중복_또는_excess_ids을_거부한다(rows: str) -> None:
    with pytest.raises(SourceContractError):
        parse_bid_list_page(list_page(rows), parser_version="eat-v1")


@pytest.mark.parametrize(
    "missing",
    ["BID_CNT", "ETN_BID_STT_NM", "BID_END_DT", "LAST_CHG_DT"],
)
def test_목록_필수_column이_없으면_발견_전체가_SOURCE_CONTRACT로_닫힌다(missing: str) -> None:
    with pytest.raises(SourceContractError):
        parse_bid_list_page(
            list_page(list_row("1", "1", **{missing: None})), parser_version="eat-v1"
        )


@pytest.mark.parametrize(
    ("column", "wire"),
    [
        ("BID_CNT", ""),
        ("BID_CNT", "-1"),
        ("BID_CNT", "１"),
        ("BID_END_DT", "2026091410"),
        ("LAST_CHG_DT", "20260902"),
        ("STRPRCE", "-5"),
    ],
)
def test_목록_값이_검토된_wire_모양을_벗어나면_추측하지_않고_거부한다(
    column: str, wire: str
) -> None:
    with pytest.raises(SourceContractError):
        parse_bid_list_page(
            list_page(list_row("1", "1", **{column: wire})), parser_version="eat-v1"
        )


def test_목록_선택_column이_비어도_필수_사실은_만들어진다() -> None:
    page = parse_bid_list_page(list_page(list_row("1", "7")), parser_version="eat-v1")

    (row,) = page.rows
    assert row.external_bid_id == "7"
    assert row.competitor_count == 1
    assert row.deadline_at.root == "2026-09-14T01:00:00Z"
    assert row.base_amount is None
    assert row.buyer_organization_code is None
    assert row.award_method_name is None


def test_0건_wire는_필수_column_없이도_빈_page가_된다() -> None:
    page = parse_bid_list_page(
        list_page('<Row><Col id="TOT_CNT">0</Col><Col id="ETN_BID_ID"></Col></Row>'),
        parser_version="eat-v1",
    )

    assert page.total_count == 0
    assert page.rows == ()


def test_목록_파싱은_실행_단위의_parser_version_계약을_따른다() -> None:
    """v2 목록 계약은 v1의 복제라 같은 결과를 내야 하고, 미검토 version은 typed 실패다."""
    payload = list_page(list_row("1", "7"))

    v1 = parse_bid_list_page(payload, parser_version="eat-v1")
    v2 = parse_bid_list_page(payload, parser_version="eat-v2")

    assert v1 == v2
    with pytest.raises(SourceContractError, match="eat-v9"):
        parse_bid_list_page(payload, parser_version="eat-v9")


def test_v1과_v2_목록_계약은_dataset과_필수_column이_같다() -> None:
    """복제 관계가 깨지면 목록 파서의 필수 column 검사가 조용히 갈라진다."""
    v1 = reviewed_schema_contract(
        source="eat", endpoint="bid-list", parser_version="eat-v1"
    )
    v2 = reviewed_schema_contract(
        source="eat", endpoint="bid-list", parser_version="eat-v2"
    )

    assert v1 is not None and v2 is not None
    assert dict(v1.datasets) == dict(v2.datasets)
    assert dict(v1.required_datasets) == dict(v2.required_datasets)
    assert v1.fingerprint == v2.fingerprint


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
        # EAT-42가 `eat-v2`를 검토된 version으로 만들었으므로 미검토 사례는 `eat-v9`로 옮긴다.
        ("eat", "bid-detail", "eat-v9", "c5270779844ac60244d94d852db2547cd42c47548dd4189d55f8f7a4e3c94adf"),
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


def test_eat_v2가_v1과_같은_필수_부분집합_fingerprint로_통과한다() -> None:
    # 두 version이 주장하는 필수 부분집합이 같으므로 관측 fingerprint도 같다. 달라진 것은 해석
    # 깊이뿐이고, 명단 블록은 required가 아니라 없어도 계약 위반이 아니다.
    assert validate_eat_schema_contract(
        source="eat",
        endpoint="bid-detail",
        parser_version="eat-v2",
        schema_fingerprint=(
            "c5270779844ac60244d94d852db2547cd42c47548dd4189d55f8f7a4e3c94adf"
        ),
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
