from __future__ import annotations

from pathlib import Path

import pytest

from eatbid.failures.errors import SourceContractError
from eatbid.generated.code_vocabulary_v1 import NormalizedCodeVocabularyEntry
from eatbid.source.eat.code_schemes import (
    ATTEMPT_STATUS,
    AUCTION_LOCATION_SIDO,
    AUCTION_LOCATION_SIGUNGU,
    EAT_CODE_LIST_GROUPS,
    ORGANIZATION_TYPE,
    code_list_scheme,
)
from eatbid.source.eat.code_vocabulary import parse_code_vocabulary
from eatbid.source.eat.registry import require
from eatbid.source.eat.xml import parse_nexacro

FIXTURE = Path(__file__).parents[1] / "fixtures" / "eat" / "code-list.xml"
NAMESPACE = "http://www.nexacroplatform.com/platform/dataset"


def _fixture_vocabulary():
    return parse_code_vocabulary(parse_nexacro(FIXTURE.read_bytes()))


def _entry(vocabulary, scheme: str, code: str) -> NormalizedCodeVocabularyEntry:
    return next(
        entry
        for entry in vocabulary.entries
        if entry.scheme == scheme and entry.code == code
    )


def _response(rows: str) -> bytes:
    return f"""<?xml version="1.0" encoding="utf-8"?>
<Root xmlns="{NAMESPACE}">
  <Parameters/>
  <Dataset id="ds_out">
    <Rows>{rows}</Rows>
  </Dataset>
</Root>""".encode()


def _row(
    *,
    group: str = "SC066",
    code: str = "15",
    name: str = "경남",
    use: str = "Y",
    deleted: str = "N",
    valid_from: str = "19000101",
    valid_to: str = "99991231",
) -> str:
    return (
        "<Row>"
        f'<Col id="CMNS_GRP_CD">{group}</Col>'
        f'<Col id="CMNS_CD">{code}</Col>'
        f'<Col id="CMNS_CD_NM">{name}</Col>'
        f'<Col id="USE_YN">{use}</Col>'
        f'<Col id="DEL_YN">{deleted}</Col>'
        f'<Col id="VLD_BGNG_YMD">{valid_from}</Col>'
        f'<Col id="VLD_END_YMD">{valid_to}</Col>'
        "</Row>"
    )


def test_그룹_넷이_각자의_체계에_이름을_준다() -> None:
    vocabulary = _fixture_vocabulary()

    assert {group.group_code for group in EAT_CODE_LIST_GROUPS} == {
        "SC066",
        "SC067",
        "EP049",
        "BC016",
    }
    assert _entry(vocabulary, AUCTION_LOCATION_SIDO.namespace, "15").label == "경남"
    assert _entry(vocabulary, AUCTION_LOCATION_SIGUNGU.namespace, "653").label == "김해시"
    assert _entry(vocabulary, ATTEMPT_STATUS.namespace, "007").label == "낙찰"
    assert _entry(vocabulary, ORGANIZATION_TYPE.namespace, "010").label == "학교"


def test_검토되지_않은_그룹은_이름을_주지_못한다() -> None:
    assert code_list_scheme("SC999") is None
    with pytest.raises(SourceContractError, match="group is not reviewed"):
        parse_code_vocabulary(parse_nexacro(_response(_row(group="SC999"))))


def test_유효기간은_소스가_준_서울_벽날짜_그대로_실린다() -> None:
    entry = _entry(_fixture_vocabulary(), ATTEMPT_STATUS.namespace, "007")

    assert entry.valid_from is not None
    assert entry.valid_to is not None
    assert entry.valid_from.root == "2021-09-30T15:00:00Z"
    # `29991231`은 무한처럼 보이지만 우리가 null로 번역하지 않는다.
    assert entry.valid_to.root.startswith("2999-12-30")


def test_소스가_유효기간을_주지_않으면_관측_시각으로_메우지_않는다() -> None:
    vocabulary = parse_code_vocabulary(
        parse_nexacro(_response(_row(valid_from="", valid_to="")))
    )

    assert vocabulary.entries[0].valid_from is None
    assert vocabulary.entries[0].valid_to is None


@pytest.mark.parametrize(("use", "deleted"), [("N", "N"), ("Y", "Y"), ("N", "Y")])
def test_그만_쓰는_코드는_지워지지_않고_active만_내려간다(use: str, deleted: str) -> None:
    vocabulary = parse_code_vocabulary(
        parse_nexacro(_response(_row(use=use, deleted=deleted)))
    )

    assert len(vocabulary.entries) == 1
    assert vocabulary.entries[0].label == "경남"
    assert vocabulary.entries[0].active is False


@pytest.mark.parametrize(("use", "deleted"), [("", "N"), ("X", "N"), ("Y", "")])
def test_사용_표시가_Y도_N도_아니면_추측하지_않고_멈춘다(use: str, deleted: str) -> None:
    with pytest.raises(SourceContractError):
        parse_code_vocabulary(parse_nexacro(_response(_row(use=use, deleted=deleted))))


@pytest.mark.parametrize("value", ["2026-09-16", "20260931", "2026091"])
def test_읽을_수_없는_유효기간은_설정_실패가_아니라_계약_위반이다(value: str) -> None:
    """왜 타입을 따지나. 그냥 새어 나가면 CONFIGURATION(우리 코드가 잘못됐다)으로 분류돼
    exit code가 바뀌고, 운영이 소스 변경을 우리 설정 오류로 읽는다."""
    with pytest.raises(SourceContractError, match="not readable"):
        parse_code_vocabulary(parse_nexacro(_response(_row(valid_from=value))))


def test_한_체계_안에서_같은_코드가_두_번_오면_우리가_고르지_않는다() -> None:
    rows = _row(name="경남") + _row(name="경상남도")

    with pytest.raises(SourceContractError, match="repeats a code"):
        parse_code_vocabulary(parse_nexacro(_response(rows)))


def test_다른_체계의_같은_코드_문자열은_충돌이_아니다() -> None:
    rows = _row(group="SC066", code="1", name="서울") + _row(
        group="SC067", code="1", name="강남구"
    )
    vocabulary = parse_code_vocabulary(parse_nexacro(_response(rows)))

    assert _entry(vocabulary, AUCTION_LOCATION_SIDO.namespace, "1").label == "서울"
    assert _entry(vocabulary, AUCTION_LOCATION_SIGUNGU.namespace, "1").label == "강남구"


def test_이름_없는_행은_어휘가_되지_못하고_제외로_세어진다() -> None:
    rows = _row(code="15", name="경남") + _row(code="8", name="")
    vocabulary = parse_code_vocabulary(parse_nexacro(_response(rows)))

    assert vocabulary.source_row_count == 2
    assert vocabulary.excluded_row_count == 1
    assert len(vocabulary.entries) == 1


def test_봉투는_원본_행_수와_제외_행_수로_어휘를_나눈다() -> None:
    vocabulary = _fixture_vocabulary()

    assert vocabulary.source_system == "eat"
    assert vocabulary.dataset == "ds_out"
    assert vocabulary.excluded_row_count == 0
    assert vocabulary.source_row_count == len(vocabulary.entries) == 17


def test_빈_응답은_어휘가_비었다는_사실로_통과하지_않는다() -> None:
    with pytest.raises(SourceContractError, match="no ds_out rows"):
        parse_code_vocabulary(parse_nexacro(_response("")))


def test_실측_fixture가_검토된_응답_모양_지문과_일치한다() -> None:
    contract = require("code-list", parser_version="eat-v1")
    parsed = parse_nexacro(FIXTURE.read_bytes())

    assert contract.schema_contract.observed_fingerprint(parsed.datasets) == (
        contract.schema_fingerprint
    )
