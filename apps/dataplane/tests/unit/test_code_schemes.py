from __future__ import annotations

import re
from pathlib import Path

from eatbid.source.eat.code_schemes import ALL_EAT_CODE_SCHEMES, EAT_CODE_SCHEMES

_REPO_ROOT = Path(__file__).parents[4]
_SOURCE_ROOT = _REPO_ROOT / "apps" / "dataplane" / "src" / "eatbid"
_SCHEME_TABLE = _SOURCE_ROOT / "source" / "eat" / "code_schemes.py"
_SEED_FILE = _REPO_ROOT / "packages" / "db" / "src" / "seeds" / "code-schemes.ts"
# 파서가 만들지 않고 core 투영·발행 완결성 검사만 쓰는 scheme도 같은 표가 갖는다. 목록 상수를 여기에
# 다시 적으면 그 자체가 두 번째 출처가 되므로 표를 읽어 비교한다.

_SEED_NAMESPACE = re.compile(r'namespace:\s*"([^"]+)"')
# 어느 모듈이든 scheme 이름을 다시 적는 것을 막는다. `code_scheme="..."` 형태든 그냥 `"eat:..."`
# 리터럴이든 둘 다 두 번째 출처가 된다.
_INLINE_SCHEME = re.compile(r'code_scheme\s*=\s*["\']|["\']eat:')


def _seed_namespaces() -> set[str]:
    return set(_SEED_NAMESPACE.findall(_SEED_FILE.read_text(encoding="utf-8")))


def test_eaT_code_scheme_표는_시드_등록_목록과_같다() -> None:
    declared = {scheme.namespace for scheme in ALL_EAT_CODE_SCHEMES}
    assert len(declared) == len(ALL_EAT_CODE_SCHEMES)
    assert {scheme.namespace for scheme in EAT_CODE_SCHEMES} < declared

    seeded = _seed_namespaces()
    assert {name for name in seeded if name.startswith("eat:")} == declared


def test_dataplane_모듈에는_code_scheme_리터럴이_남지_않는다() -> None:
    offenders = {
        str(module.relative_to(_SOURCE_ROOT)): _INLINE_SCHEME.findall(
            module.read_text(encoding="utf-8")
        )
        for module in sorted(_SOURCE_ROOT.rglob("*.py"))
        if module != _SCHEME_TABLE
    }

    assert {name: hits for name, hits in offenders.items() if hits} == {}


def test_행안부_체계_이름은_source_계약_모듈_하나만_선언한다() -> None:
    """행안부 체계 이름도 eaT 체계와 같은 규칙을 받는다.

    TypeScript 쪽은 `pnpm lint:region-vocabulary`가 같은 사실을 지키므로 Python 전용 도구를 따로
    만들지 않고 이 자리에서 단일 선언만 확인한다(AGENTS 22).
    """
    seeded = {name for name in _seed_namespaces() if name.startswith("mois:")}
    assert seeded, "시드가 행안부 체계를 등록해야 한다"

    declaring = {
        str(module.relative_to(_SOURCE_ROOT))
        for module in sorted(_SOURCE_ROOT.rglob("*.py"))
        if any(name in module.read_text(encoding="utf-8") for name in seeded)
    }
    assert declaring == {str(Path("source") / "reference" / "source_contracts.py")}


def test_code_scheme_이름은_소스_column명이_아니라_의미_이름이다() -> None:
    for scheme in ALL_EAT_CODE_SCHEMES:
        namespace = scheme.namespace
        assert namespace.startswith("eat:")
        semantic = namespace.removeprefix("eat:")
        assert re.fullmatch(r"[a-z]+(?:-[a-z]+)*", semantic), namespace
        assert scheme.source_column.isupper()
