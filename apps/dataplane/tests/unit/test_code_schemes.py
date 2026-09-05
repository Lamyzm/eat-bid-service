from __future__ import annotations

import re
from pathlib import Path

from eatbid.source.eat.code_schemes import EAT_CODE_SCHEMES

_REPO_ROOT = Path(__file__).parents[4]
_PARSER_DIR = _REPO_ROOT / "apps" / "dataplane" / "src" / "eatbid" / "source" / "eat"
_SEED_FILE = _REPO_ROOT / "packages" / "db" / "src" / "seeds" / "code-schemes.ts"

# 파서가 만들지 않는 eaT scheme이다. 공고 목록·기관 foundation 경로가 싣는 것이라 상세 파서의
# 표에 없어도 시드에는 있어야 한다. 이 목록을 두는 이유는 "시드에 있는데 어디서도 등록되지 않은
# eaT scheme"을 실패로 잡기 위해서다. 새 scheme을 시드에만 추가하면 여기서 걸린다.
_FOUNDATION_NAMESPACES = frozenset(
    {
        "eat:auction-location-sido",
        "eat:auction-location-sigungu",
        "eat:eligibility-area",
        "eat:organization",
    }
)

_SEED_NAMESPACE = re.compile(r'namespace:\s*"([^"]+)"')
# 파서 모듈이 scheme 이름을 다시 적는 것을 막는다. `code_scheme="..."` 형태든 그냥 `"eat:..."`
# 리터럴이든 둘 다 두 번째 출처가 된다.
_INLINE_SCHEME = re.compile(r'code_scheme\s*=\s*["\']|["\']eat:')


def _seed_namespaces() -> set[str]:
    return set(_SEED_NAMESPACE.findall(_SEED_FILE.read_text(encoding="utf-8")))


def test_파서가_쓰는_code_scheme은_등록_목록과_같다() -> None:
    declared = {scheme.namespace for scheme in EAT_CODE_SCHEMES}
    assert len(declared) == len(EAT_CODE_SCHEMES)

    seeded = _seed_namespaces()
    assert declared <= seeded
    assert {name for name in seeded if name.startswith("eat:")} - _FOUNDATION_NAMESPACES == declared


def test_파서_모듈에는_code_scheme_리터럴이_남지_않는다() -> None:
    offenders = {
        module.name: _INLINE_SCHEME.findall(module.read_text(encoding="utf-8"))
        for module in sorted(_PARSER_DIR.glob("*.py"))
        if module.name != "code_schemes.py"
    }

    assert {name: hits for name, hits in offenders.items() if hits} == {}


def test_code_scheme_이름은_소스_column명이_아니라_의미_이름이다() -> None:
    for scheme in EAT_CODE_SCHEMES:
        namespace = scheme.namespace
        assert namespace.startswith("eat:")
        semantic = namespace.removeprefix("eat:")
        assert re.fullmatch(r"[a-z]+(?:-[a-z]+)*", semantic), namespace
        assert scheme.source_column.isupper()
