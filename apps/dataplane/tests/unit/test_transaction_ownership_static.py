"""트랜잭션 블록 밖에서 커서를 여는 dataplane 코드를 소스만 읽어 잡아낸다(ADR 0059 결정 3).

공유 연결에서 블록 없이 커서를 쓰면 psycopg가 암묵 트랜잭션을 남기고, 다음 저장소의 블록이 savepoint가
되어 쓰기가 성공한 채 사라진다(EAT-264·273·274). 관용구가 강제 장치 없이 세 번 무너졌으므로 사람의 기억
대신 이 검사가 막는다.

판정은 문법만 본다. `with X.cursor(...)`는 같은 `with`의 앞 항목이나 같은 함수 안에서 감싸는 `with`가
같은 수신자(`ast.unparse` 문자열)의 `X.transaction(...)`을 열 때만 통과한다. `with` 항목이 아닌 맨
`X.cursor()` 호출은 언제나 잡는다. 호출자가 이미 트랜잭션을 연 연결을 받는 함수는 아래 허용 목록에 이유와
함께 적는다.
"""

from __future__ import annotations

import ast
from dataclasses import dataclass
from pathlib import Path

SOURCE_ROOT = Path(__file__).resolve().parents[2] / "src" / "eatbid"

# "src/eatbid 기준 모듈 경로::함수 qualname" → 트랜잭션 블록 없이 커서를 여는 것이 옳은 이유.
# 새 항목을 더하기 전에 `with conn.transaction(), conn.cursor()`로 고칠 수 없는지 먼저 본다.
ALLOWED_OUTSIDE_TRANSACTION: dict[str, str] = {
    "mart/build_coverage.py::fill_build_coverage": (
        "호출자(PsycopgMartBuildRepository.fill_build)가 트랜잭션을 연다 — 보유율은 빌더 행과 같은 원자 단위다"
    ),
    "mart/build_exclusion.py::fill_build_exclusions": (
        "호출자(PsycopgMartBuildRepository.fill_build)가 트랜잭션을 연다 — 제외 부속 행은 빌더 행과 같은 원자 단위다"
    ),
    "mart/region_axis.py::assert_build_region_scheme": (
        "호출자(PsycopgMartBuildRepository.verify_build)가 트랜잭션을 연다 — 체계 검사 실패는 검증 전이와 함께 되감긴다"
    ),
    "mart/org_round_summary.py::fill_org_round_summary": (
        "mart 빌더다. 호출자(fill_build)가 트랜잭션을 열고 빌더는 받은 연결로 커서만 연다(ADR 0059 결정 1)"
    ),
    "mart/win_rate_distribution.py::fill_win_rate_distribution": (
        "mart 빌더다. 호출자(fill_build)가 트랜잭션을 열고 빌더는 받은 연결로 커서만 연다(ADR 0059 결정 1)"
    ),
    "mart/open_auction_snapshot.py::fill_open_auction_snapshot": (
        "mart 빌더다. 호출자(fill_build)가 트랜잭션을 열고 빌더는 받은 연결로 커서만 연다(ADR 0059 결정 1)"
    ),
    "mart/open_auction_snapshot.py::_fill_terms": (
        "스냅샷 빌더(fill_open_auction_snapshot)의 한 단계라 호출자(fill_build)의 트랜잭션 안에서 돈다"
    ),
    "composition.py::_MonitoringRunner._execute": (
        "감시 회차 지표는 문장마다 commit한다 — 회차가 중간에 죽어도 그때까지의 기록을 남긴다(ADR 0054)"
    ),
    "composition.py::_MonitoringRunner._mutate": (
        "위반 표 쓰기는 문장마다 commit한다 — 다음 문장이 방금 insert한 id를 참조하고 반쪽 기록이 없는 것보다 낫다(ADR 0054)"
    ),
}


@dataclass(frozen=True)
class Finding:
    """트랜잭션 블록 밖에서 커서를 얻는 한 자리."""

    location: str
    line: int
    receiver: str


def _method_call(node: ast.expr, method: str) -> str | None:
    """`X.method(...)` 호출이면 수신자 X의 소스 문자열을, 아니면 None을 돌려준다."""
    if (
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == method
    ):
        return ast.unparse(node.func.value)
    return None


class _CursorScopeVisitor(ast.NodeVisitor):
    """함수 단위로 열린 `transaction()` 수신자를 쌓으며 `cursor()` 호출을 판정한다."""

    def __init__(self, module: str) -> None:
        self._module = module
        self._names: list[str] = []
        # 함수 경계마다 새 목록이다. 감싸는 함수의 블록이 안쪽 함수의 호출 시점까지 열려 있다는 보장이 없다.
        self._open_transactions: list[str] = []
        self._with_cursor_calls: set[int] = set()
        self.findings: list[Finding] = []

    def _location(self) -> str:
        return f"{self._module}::{'.'.join(self._names) or '<module>'}"

    def _enter_scope(self, node: ast.ClassDef | ast.FunctionDef | ast.AsyncFunctionDef) -> None:
        self._names.append(node.name)
        saved = self._open_transactions
        if not isinstance(node, ast.ClassDef):
            self._open_transactions = []
        self.generic_visit(node)
        self._open_transactions = saved
        self._names.pop()

    visit_ClassDef = _enter_scope
    visit_FunctionDef = _enter_scope
    visit_AsyncFunctionDef = _enter_scope

    def _visit_with(self, node: ast.With | ast.AsyncWith) -> None:
        opened: list[str] = []
        for item in node.items:
            transaction_receiver = _method_call(item.context_expr, "transaction")
            if transaction_receiver is not None:
                opened.append(transaction_receiver)
            cursor_receiver = _method_call(item.context_expr, "cursor")
            if cursor_receiver is not None:
                # 아래 visit_Call이 같은 호출을 맨 호출로 다시 세지 않게 먼저 표시한다.
                self._with_cursor_calls.add(id(item.context_expr))
                if (
                    cursor_receiver not in opened
                    and cursor_receiver not in self._open_transactions
                ):
                    self._record(item.context_expr, cursor_receiver)
            self.visit(item.context_expr)
            if item.optional_vars is not None:
                self.visit(item.optional_vars)
        self._open_transactions.extend(opened)
        for statement in node.body:
            self.visit(statement)
        del self._open_transactions[len(self._open_transactions) - len(opened) :]

    visit_With = _visit_with
    visit_AsyncWith = _visit_with

    def visit_Call(self, node: ast.Call) -> None:
        receiver = _method_call(node, "cursor")
        if receiver is not None and id(node) not in self._with_cursor_calls:
            # `with` 항목이 아닌 맨 호출은 누가 트랜잭션을 여는지 문법으로 보장할 수 없다.
            self._record(node, receiver)
        self.generic_visit(node)

    def _record(self, node: ast.expr, receiver: str) -> None:
        self.findings.append(Finding(self._location(), node.lineno, receiver))


def find_cursors_outside_transaction(source: str, *, module: str) -> list[Finding]:
    visitor = _CursorScopeVisitor(module)
    visitor.visit(ast.parse(source))
    return visitor.findings


def _scan_source_tree() -> list[Finding]:
    findings: list[Finding] = []
    for path in sorted(SOURCE_ROOT.rglob("*.py")):
        module = path.relative_to(SOURCE_ROOT).as_posix()
        findings.extend(
            find_cursors_outside_transaction(path.read_text(encoding="utf-8"), module=module)
        )
    return findings


def test_dataplane은_허용_목록_밖에서_트랜잭션_없이_커서를_열지_않는다() -> None:
    findings = _scan_source_tree()
    assert findings, "검사가 아무 커서도 보지 못했다 — 경로나 판정이 망가졌다"

    violations = [
        f"{finding.location}:{finding.line} ({finding.receiver}.cursor())"
        for finding in findings
        if finding.location not in ALLOWED_OUTSIDE_TRANSACTION
    ]
    assert violations == [], (
        "트랜잭션 블록 밖의 커서다. `with conn.transaction(), conn.cursor()`로 감싸거나, 호출자가 "
        "트랜잭션을 여는 것이 설계라면 ALLOWED_OUTSIDE_TRANSACTION에 이유와 함께 적는다:\n"
        + "\n".join(violations)
    )


def test_더_이상_어떤_코드에도_맞지_않는_허용_목록_항목은_실패한다() -> None:
    matched = {finding.location for finding in _scan_source_tree()}
    stale = sorted(set(ALLOWED_OUTSIDE_TRANSACTION) - matched)
    assert stale == [], f"낡은 예외다. 코드가 고쳐졌거나 옮겨졌으면 항목을 지운다: {stale}"


def test_검사기는_맨_커서와_다른_수신자의_트랜잭션을_잡는다() -> None:
    source = """
def bare(connection):
    with connection.cursor() as cursor:
        cursor.execute("select 1")

def loose(connection):
    cursor = connection.cursor()
    cursor.execute("select 1")

def other_receiver(connection, other):
    with other.transaction(), connection.cursor() as cursor:
        cursor.execute("select 1")

def cursor_before_transaction(connection):
    with connection.cursor() as cursor, connection.transaction():
        cursor.execute("select 1")

def outer(connection):
    with connection.transaction():
        def inner():
            with connection.cursor() as cursor:
                cursor.execute("select 1")
        return inner
"""
    findings = find_cursors_outside_transaction(source, module="synthetic.py")

    assert [(finding.location, finding.line) for finding in findings] == [
        ("synthetic.py::bare", 3),
        ("synthetic.py::loose", 7),
        ("synthetic.py::other_receiver", 11),
        ("synthetic.py::cursor_before_transaction", 15),
        ("synthetic.py::outer.inner", 21),
    ]


def test_검사기는_같은_with나_감싸는_with의_트랜잭션_안_커서를_통과시킨다() -> None:
    source = """
class Repository:
    def same_with(self):
        with self._connection.transaction(), self._connection.cursor() as cursor:
            cursor.execute("select 1")

    def enclosing_with(self):
        with self._connection.transaction():
            for _ in range(2):
                with self._connection.cursor() as cursor:
                    cursor.execute("select 1")

async def parenthesized(connection):
    async with (
        connection.transaction(),
        connection.cursor() as cursor,
    ):
        await cursor.execute("select 1")
"""
    assert find_cursors_outside_transaction(source, module="synthetic.py") == []
