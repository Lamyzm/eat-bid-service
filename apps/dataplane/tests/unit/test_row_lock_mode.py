from __future__ import annotations

import re
from pathlib import Path

_SOURCE_ROOT = Path(__file__).parents[2] / "src" / "eatbid"
# 발행·수집이 쓰는 두 층이다. mart는 자기 빌드 행을 지우므로(`mart/postgres_repository.py`,
# `mart/reaper.py`) `FOR UPDATE`가 맞고 이 규칙 밖이다.
_WRITER_LAYERS = ("core", "ingest")
# `for no key update`가 아닌 맨 `for update`다. 대소문자를 가리지 않는다.
_BARE_FOR_UPDATE = re.compile(r"\bfor\s+(?!no\s+key\s+)update\b", re.IGNORECASE)


def _takes_bare_for_update(line: str) -> bool:
    """SQL 한 줄이 맨 `FOR UPDATE`를 거는지다. 주석 줄은 이유를 설명하느라 그 이름을 부를 수 있으므로
    뺀다 — SQL 문자열 안의 줄은 `#`로 시작하지 않는다."""
    return not line.lstrip().startswith("#") and _BARE_FOR_UPDATE.search(line) is not None


def _writer_modules() -> list[Path]:
    return sorted(
        module
        for layer in _WRITER_LAYERS
        for module in (_SOURCE_ROOT / layer).rglob("*.py")
    )


def test_core와_ingest는_행을_맨_FOR_UPDATE로_잠그지_않는다() -> None:
    """왜: mart 표는 core·ingest 행을 외래키로 가리키고, 행을 넣을 때마다 PostgreSQL이 가리키는 행에
    `FOR KEY SHARE`를 건다. `FOR UPDATE`는 그것과 충돌하고 `FOR NO KEY UPDATE`는 충돌하지 않는다.
    mart 빌드는 발행과 동시에 돌아, 2026-09-19~28에 교착이 7번 났고
    daily-reconcile 발행 둘(15,167건·10,129건)이 통째로 버려졌다(EAT-286).

    core·ingest는 잠근 행을 지우거나 키를 바꾸지 않으므로 `FOR NO KEY UPDATE`로 잃는 보호가 없다.
    지우는 코드가 생기면 그 자리만 `FOR UPDATE`로 두고 이 시험에 이유와 함께 예외로 적는다.
    """
    modules = _writer_modules()
    assert modules, "core·ingest 모듈을 찾지 못했다 — 경로가 바뀌면 이 시험이 아무것도 안 본다"

    offenders = [
        f"{module.relative_to(_SOURCE_ROOT)}:{number}: {line.strip()}"
        for module in modules
        for number, line in enumerate(module.read_text(encoding="utf-8").splitlines(), start=1)
        if _takes_bare_for_update(line)
    ]
    assert offenders == []


def test_맨_FOR_UPDATE_탐지는_NO_KEY_UPDATE를_통과시키고_맨_형태만_잡는다() -> None:
    """왜: 정규식이 틀리면 위 시험이 늘 통과한다. 잡아야 할 것과 놓아줘야 할 것을 한 번씩 확인한다."""
    assert _BARE_FOR_UPDATE.search("select 1 from core.organization for update")
    assert _BARE_FOR_UPDATE.search("... FOR UPDATE OF oi, o")
    assert _BARE_FOR_UPDATE.search("where id = %s for  update")
    assert not _BARE_FOR_UPDATE.search("select 1 from core.organization for no key update")
    assert not _BARE_FOR_UPDATE.search("... FOR NO KEY UPDATE OF oi, o")
    assert not _BARE_FOR_UPDATE.search("update core.organization set canonical_name = %s")
    # 이유를 적는 주석은 잠금이 아니다. 다만 SQL 줄은 들여쓰기가 있어도 잡는다.
    assert not _takes_bare_for_update("    # `FOR UPDATE`는 mart의 외래키 검사와 충돌했다")
    assert _takes_bare_for_update("            where run_id = %s for update")


def test_mart는_자기_빌드_행을_지우므로_FOR_UPDATE를_유지한다() -> None:
    """왜: 규칙을 dataplane 전체로 넓히면 빌드를 교체·회수하며 지우는 mart 잠금이 약해진다. 경계가
    어디인지 시험이 말하게 둔다."""
    mart = (_SOURCE_ROOT / "mart" / "postgres_repository.py").read_text(encoding="utf-8")
    assert _BARE_FOR_UPDATE.search(mart)
    assert "delete from mart.build" in mart


# 발행끼리 함께 쓰는 core 공유 표다. 투영은 이 행을 고치지 않고 넣거나 가리키기만 한다(ADR 0070).
_SHARED_TABLES = (
    "core.code_value",
    "core.code_label_observation",
    "core.organization_identifier",
    "core.organization",
    "core.supplier_party",
    "core.source_supplier_account",
    "core.auction_attempt",
)
# 공고 투영 경로의 writer다. 기준정보 투영(code_release·code_vocabulary·region_mapping)은 자기들끼리 mutex로 줄을 서므로
# 이 규칙 밖이다.
_PROJECTION_WRITERS = (
    "postgres_code_values.py",
    "postgres_projection_writer.py",
    "postgres_lineage_writer.py",
    "postgres_supplier_writer.py",
)
_SQL_LITERAL = re.compile(r'"""(.*?)"""', re.DOTALL)
_FROM_TABLE = re.compile(r"\bfrom\s+(core\.\w+)", re.IGNORECASE)
_NO_KEY_UPDATE = re.compile(r"\bfor\s+no\s+key\s+update\b", re.IGNORECASE)


def _shared_row_locks_with_no_key_update(source: str) -> list[str]:
    offenders: list[str] = []
    for literal in _SQL_LITERAL.findall(source):
        match = _FROM_TABLE.search(literal)
        if match and match.group(1) in _SHARED_TABLES and _NO_KEY_UPDATE.search(literal):
            offenders.append(" ".join(literal.split())[:120])
    return offenders


def test_공고_투영은_공유_행을_참조_잠금으로만_잠근다() -> None:
    """왜: 발행은 mutex 없이 동시에 돈다(ADR 0070). 공유 행을 `FOR NO KEY UPDATE`로 잠그면 같은 잠금끼리 막혀,
    2만 건을 한 거래로 쓰는 재처리가 같은 학교·업체를 쓰는 정시 수집을 한 시간 붙잡는다(2026-10-16 08:25 회차)."""
    offenders = [
        f"{name}: {statement}"
        for name in _PROJECTION_WRITERS
        for statement in _shared_row_locks_with_no_key_update(
            (_SOURCE_ROOT / "core" / name).read_text(encoding="utf-8")
        )
    ]
    assert offenders == []


def test_공유_행_잠금_탐지는_공유_표의_NO_KEY_UPDATE만_잡는다() -> None:
    """왜: 정규식이 틀리면 위 시험이 늘 통과한다."""
    assert _shared_row_locks_with_no_key_update(
        '''cursor.execute("""select code_value_id from core.code_value where code = %s for no key update""")'''
    )
    assert not _shared_row_locks_with_no_key_update(
        '''cursor.execute("""select code_value_id from core.code_value where code = %s for key share""")'''
    )
    # 자기 개정본 행은 공유 표가 아니다.
    assert not _shared_row_locks_with_no_key_update(
        '''cursor.execute("""select 1 from core.auction_revision where normalized_record_id = %s for no key update""")'''
    )
