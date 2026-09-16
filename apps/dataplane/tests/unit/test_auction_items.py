from __future__ import annotations

import re
from pathlib import Path

from eatbid.core.auction_items import read_item_label
from eatbid.source.eat.code_schemes import AUCTION_ITEM_ATOMS, AUCTION_ITEM_SCHEME

_REPO_ROOT = Path(__file__).parents[4]
_ATOM_SEED = _REPO_ROOT / "packages" / "db" / "src" / "seeds" / "auction-items.ts"
_SCHEME_SEED = _REPO_ROOT / "packages" / "db" / "src" / "seeds" / "code-schemes.ts"

_QUOTED = re.compile(r'"([^"\\]+)"')


def test_원자_목록이_시드와_같다() -> None:
    """목록 상수를 여기 다시 적으면 그 자체가 세 번째 출처가 되므로 시드 파일을 읽어 비교한다."""
    seeded = _QUOTED.findall(
        _ATOM_SEED.read_text(encoding="utf-8").split("auctionItemAtoms = [")[1].split("]")[0]
    )

    assert list(AUCTION_ITEM_ATOMS) == seeded
    assert AUCTION_ITEM_SCHEME in _QUOTED.findall(_SCHEME_SEED.read_text(encoding="utf-8"))


def test_라벨이_없으면_원자도_미매핑도_없다() -> None:
    reading = read_item_label(None)

    assert reading.atoms == ()
    assert reading.unmapped == ()


def test_단일_원자_라벨을_그대로_읽는다() -> None:
    assert read_item_label("육류").atoms == ("육류",)


def test_실측_구분자인_공백_쉼표_공백으로_쪼갠다() -> None:
    reading = read_item_label("농산물 , 수산물 , 가공식품 , 김치류 , 곡류")

    assert reading.atoms == ("농산물", "수산물", "가공식품", "김치류", "곡류")
    assert reading.unmapped == ()


def test_공백_없는_쉼표도_같은_규칙으로_읽는다() -> None:
    """실측에는 없지만 원천이 공백을 빼고 보내도 조각의 뜻은 같다."""
    assert read_item_label("육류,가금류").atoms == ("육류", "가금류")


def test_모르는_낱말은_원자에_섞이지_않고_따로_남는다() -> None:
    reading = read_item_label("육류 , 신선편의")

    assert reading.atoms == ("육류",)
    assert reading.unmapped == ("신선편의",)


def test_모두_모르는_낱말이면_원자는_비고_미매핑만_남는다() -> None:
    reading = read_item_label("신선편의 , 밀키트")

    assert reading.atoms == ()
    assert reading.unmapped == ("신선편의", "밀키트")


def test_같은_낱말이_두_번_적혀도_한_번만_남는다() -> None:
    reading = read_item_label("육류 , 육류 , 신선편의 , 신선편의")

    assert reading.atoms == ("육류",)
    assert reading.unmapped == ("신선편의",)


def test_빈_조각은_미매핑으로_세지_않는다() -> None:
    reading = read_item_label("육류 ,  , 가금류")

    assert reading.atoms == ("육류", "가금류")
    assert reading.unmapped == ()
