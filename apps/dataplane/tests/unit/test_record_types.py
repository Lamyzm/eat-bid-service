from __future__ import annotations

import ast
from pathlib import Path

import pytest

from eatbid.core.record_types import (
    PROJECTABLE_RECORD_TYPES,
    is_projectable_record_type,
)

SOURCE_ROOT = Path(__file__).parents[2] / "src" / "eatbid"
# record type 이름 자체를 소유하는 두 곳이다. registry는 (endpoint, parser version)이 어떤 이름을
# 내는지 정하고, record_types는 그중 무엇이 발행 가능한지 정한다.
_NAMING_AUTHORITIES = {
    Path("core") / "record_types.py",
    Path("source") / "eat" / "registry.py",
}


def _has_record_type_literal(path: Path) -> bool:
    """모듈이 record type 이름을 값으로 들고 있는지 본다.

    왜 부분 문자열 검색이 아닌가. 주석이나 docstring이 record type 이름을 설명하는 것은 권위를
    흩는 일이 아닌데, 문자열 검색은 그 둘을 구분하지 못해 설명을 지우게 만든다. 검사해야 하는
    것은 코드가 그 이름을 값으로 쓰느냐이므로 실제 문자열 상수만 본다.
    """
    tree = ast.parse(path.read_text(encoding="utf-8"))
    docstrings = {
        node.body[0].value
        for node in ast.walk(tree)
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef))
        and node.body
        and isinstance(node.body[0], ast.Expr)
        and isinstance(node.body[0].value, ast.Constant)
    }
    return any(
        node not in docstrings
        and isinstance(node.value, str)
        and node.value.startswith("auction.")
        for node in ast.walk(tree)
        if isinstance(node, ast.Constant)
    )


def test_발행_가능_record_type은_공고_v1과_v2_둘이다() -> None:
    assert PROJECTABLE_RECORD_TYPES == frozenset({"auction.v1", "auction.v2"})
    assert is_projectable_record_type("auction.v1")
    assert is_projectable_record_type("auction.v2")


def test_모르는_record_type은_여전히_발행_대상이_아니다() -> None:
    assert not is_projectable_record_type("auction-discovery.v1")
    assert not is_projectable_record_type("organization")


@pytest.mark.parametrize(
    "module",
    [
        Path("pipeline") / "project.py",
        Path("core") / "postgres_topology.py",
    ],
)
def test_발행_판정하는_두_곳이_record_type_문자열을_직접_들지_않는다(
    module: Path,
) -> None:
    """두 곳이 각자 문자열을 비교하면 새 record type을 열 때 한 곳만 열려 나머지 하나가 조용히 막는다.

    그 실패는 발행 시점에야 드러나므로 단위 테스트로는 재현되지 않는다. 여기서 막는 것은 값이
    아니라 권위가 다시 흩어지는 일이다.
    """
    assert not _has_record_type_literal(SOURCE_ROOT / module)


def test_record_type_이름은_두_권위_밖에서_정의되지_않는다() -> None:
    offenders = sorted(
        path.relative_to(SOURCE_ROOT).as_posix()
        for path in SOURCE_ROOT.rglob("*.py")
        if "__pycache__" not in path.parts
        and "generated" not in path.parts
        and path.relative_to(SOURCE_ROOT) not in _NAMING_AUTHORITIES
        and _has_record_type_literal(path)
    )

    assert offenders == []
