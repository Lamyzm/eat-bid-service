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


def test_발행_가능_record_type은_아직_v1_하나뿐이다() -> None:
    assert PROJECTABLE_RECORD_TYPES == frozenset({"auction.v1"})
    assert is_projectable_record_type("auction.v1")
    assert not is_projectable_record_type("auction.v2")


@pytest.mark.parametrize(
    "module",
    [
        Path("pipeline") / "project.py",
        Path("foundation.py"),
        Path("postgres_topology.py"),
    ],
)
def test_발행_판정하는_세_곳이_record_type_문자열을_직접_들지_않는다(
    module: Path,
) -> None:
    """왜 소스를 읽어 검사하나.

    세 곳이 각자 문자열을 비교하면 새 record type을 열 때 한 곳만 열려 나머지 둘이 조용히 막는다.
    그 실패는 발행 시점에야 드러나므로 단위 테스트로는 재현되지 않는다. 여기서 막는 것은 값이
    아니라 권위가 다시 흩어지는 일이다.
    """
    tree = ast.parse((SOURCE_ROOT / module).read_text(encoding="utf-8"))

    literals = [
        node.value
        for node in ast.walk(tree)
        if isinstance(node, ast.Constant)
        and isinstance(node.value, str)
        and node.value.startswith("auction.")
    ]

    assert literals == []


def test_record_type_이름은_두_권위_밖에서_정의되지_않는다() -> None:
    offenders = sorted(
        path.relative_to(SOURCE_ROOT).as_posix()
        for path in SOURCE_ROOT.rglob("*.py")
        if "__pycache__" not in path.parts
        and "generated" not in path.parts
        and path.relative_to(SOURCE_ROOT) not in _NAMING_AUTHORITIES
        and '"auction.v' in path.read_text(encoding="utf-8")
    )

    assert offenders == []
