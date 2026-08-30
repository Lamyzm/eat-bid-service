from __future__ import annotations

import argparse
import ast
import sys
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

SEMANTIC_NAME = (
    "amount",
    "money",
    "price",
    "rate",
    "ratio",
    "percent",
    "percentage",
)
SOURCE_MODEL_PREFIX = "apps/dataplane/src/eatbid/source/"
GENERATED_MODEL = "apps/dataplane/src/eatbid/generated/ingestion_v1.py"


@dataclass(frozen=True, order=True)
class Violation:
    path: str
    line: int
    column: int
    rule: str
    message: str


def _path_text(path: Path, root: Path) -> str:
    return path.relative_to(root).as_posix()


def _name_is_semantic(name: str) -> bool:
    lowered = name.lower()
    return any(part in lowered for part in SEMANTIC_NAME)


def _literal_none(node: ast.expr | None) -> bool:
    return node is None or isinstance(node, ast.Constant) and node.value is None


class AliasResolver:
    """작은 module-local binding graph로 import/assignment alias의 원점을 보존한다."""

    def __init__(self, tree: ast.Module) -> None:
        self.bindings: dict[str, ast.expr | frozenset[str]] = {}
        self.shadowed: set[str] = set()
        self._collect(tree)

    def _collect(self, tree: ast.Module) -> None:
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    local = alias.asname or alias.name.split(".", 1)[0]
                    self.bindings[local] = frozenset({f"module:{alias.name}"})
            elif isinstance(node, ast.ImportFrom) and node.module:
                for alias in node.names:
                    if alias.name == "*":
                        continue
                    local = alias.asname or alias.name
                    self.bindings[local] = frozenset({f"symbol:{node.module}.{alias.name}"})
            elif isinstance(node, ast.Assign):
                for target in node.targets:
                    self._bind_target(target, node.value)
            elif isinstance(node, ast.AnnAssign) and node.value is not None:
                self._bind_target(node.target, node.value)
            elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                self.shadowed.add(node.name)

    def _bind_target(self, target: ast.expr, value: ast.expr) -> None:
        if isinstance(target, ast.Name):
            self.bindings[target.id] = value
            self.shadowed.add(target.id)
        elif isinstance(target, (ast.Tuple, ast.List)) and isinstance(value, (ast.Tuple, ast.List)):
            for child, item in zip(target.elts, value.elts, strict=False):
                self._bind_target(child, item)

    def origins(self, node: ast.expr, seen: frozenset[str] = frozenset()) -> frozenset[str]:
        if isinstance(node, ast.Name):
            if node.id in seen:
                return frozenset()
            binding = self.bindings.get(node.id)
            if isinstance(binding, frozenset):
                return binding
            if isinstance(binding, ast.expr):
                return self.origins(binding, seen | {node.id})
            if node.id == "float" and node.id not in self.shadowed:
                return frozenset({"builtin:float"})
            return frozenset()
        if isinstance(node, ast.Attribute):
            bases = self.origins(node.value, seen)
            return frozenset(f"{base}.{node.attr}" for base in bases)
        if isinstance(node, ast.IfExp):
            return self.origins(node.body, seen) | self.origins(node.orelse, seen)
        if isinstance(node, ast.BoolOp):
            result: frozenset[str] = frozenset()
            for value in node.values:
                result |= self.origins(value, seen)
            return result
        return frozenset()


def _is_datetime_class(origin: str) -> bool:
    return origin in {"symbol:datetime.datetime", "module:datetime.datetime"}


def _is_datetime_method(origin: str, method: str) -> bool:
    return origin in {
        f"symbol:datetime.datetime.{method}",
        f"module:datetime.datetime.{method}",
    }


def _has_non_none_timezone(call: ast.Call, keyword: str = "tz") -> bool:
    if call.args and not _literal_none(call.args[0]):
        return True
    return any(item.arg in {keyword, "tzinfo"} and not _literal_none(item.value) for item in call.keywords)


def _annotation_contains_float(node: ast.expr, resolver: AliasResolver) -> bool:
    if "builtin:float" in resolver.origins(node):
        return True
    return any(_annotation_contains_float(child, resolver) for child in ast.iter_child_nodes(node) if isinstance(child, ast.expr))


def _target_names(node: ast.expr) -> Iterable[str]:
    if isinstance(node, ast.Name):
        yield node.id
    elif isinstance(node, ast.Attribute):
        yield node.attr
    elif isinstance(node, (ast.Tuple, ast.List)):
        for item in node.elts:
            yield from _target_names(item)


class SemanticVisitor(ast.NodeVisitor):
    def __init__(self, path: str, resolver: AliasResolver) -> None:
        self.path = path
        self.resolver = resolver
        self.violations: list[Violation] = []
        self.parents: list[ast.AST] = []

    def visit(self, node: ast.AST) -> None:
        self.parents.append(node)
        try:
            super().visit(node)
        finally:
            self.parents.pop()

    def report(self, node: ast.AST, rule: str, message: str) -> None:
        self.violations.append(Violation(
            self.path,
            getattr(node, "lineno", 1),
            getattr(node, "col_offset", 0) + 1,
            rule,
            message,
        ))

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        allowed_model = self.path.startswith(SOURCE_MODEL_PREFIX) or self.path == GENERATED_MODEL
        if not allowed_model:
            origins = set().union(*(self.resolver.origins(base) for base in node.bases)) if node.bases else set()
            if any(origin.endswith(("pydantic.BaseModel", "pydantic.RootModel")) for origin in origins):
                self.report(
                    node,
                    "handwritten-normalized-pydantic",
                    "normalized Pydantic models must be generated from the versioned JSON Schema",
                )
        self.generic_visit(node)

    def visit_AnnAssign(self, node: ast.AnnAssign) -> None:
        names = tuple(_target_names(node.target))
        if any(_name_is_semantic(name) for name in names) and _annotation_contains_float(node.annotation, self.resolver):
            self.report(node, "float-semantic-value", "money and rate annotations must use Decimal, not float")
        self.generic_visit(node)

    def visit_arg(self, node: ast.arg) -> None:
        if node.annotation and _name_is_semantic(node.arg) and _annotation_contains_float(node.annotation, self.resolver):
            self.report(node, "float-semantic-value", "money and rate parameters must use Decimal, not float")
        self.generic_visit(node)

    def visit_Call(self, node: ast.Call) -> None:
        origins = self.resolver.origins(node.func)
        if any(_is_datetime_class(origin) for origin in origins):
            has_tzinfo = any(item.arg == "tzinfo" and not _literal_none(item.value) for item in node.keywords)
            if not has_tzinfo:
                self.report(node, "naive-datetime", "datetime construction must provide an explicit tzinfo")
        elif any(_is_datetime_method(origin, "now") for origin in origins):
            if not _has_non_none_timezone(node):
                self.report(node, "naive-datetime", "datetime.now() must receive an explicit timezone")
        elif any(_is_datetime_method(origin, "utcnow") for origin in origins):
            self.report(node, "naive-datetime", "datetime.utcnow() returns a naive datetime")
        elif any(_is_datetime_method(origin, "fromtimestamp") for origin in origins):
            timezone_argument = len(node.args) > 1 and not _literal_none(node.args[1])
            timezone_keyword = any(item.arg == "tz" and not _literal_none(item.value) for item in node.keywords)
            if not timezone_argument and not timezone_keyword:
                self.report(node, "naive-datetime", "datetime.fromtimestamp() must receive a timezone")

        if any(origin in {"symbol:time.sleep", "module:time.sleep", "symbol:asyncio.sleep", "module:asyncio.sleep"} for origin in origins):
            argument = node.args[0] if node.args else None
            named_duration = (
                isinstance(argument, ast.Call)
                and isinstance(argument.func, ast.Attribute)
                and argument.func.attr == "total_seconds"
            )
            if argument is None or isinstance(argument, (ast.Constant, ast.BinOp, ast.UnaryOp)) or not named_duration:
                self.report(node, "raw-sleep-value", "sleep duration must come from a named timedelta conversion")

        if "builtin:float" in origins and self._call_feeds_semantic_value(node):
            self.report(node, "float-semantic-value", "money and rate normalization must not convert through float")
        self.generic_visit(node)

    def _call_feeds_semantic_value(self, node: ast.Call) -> bool:
        if len(self.parents) < 2:
            return False
        parent = self.parents[-2]
        if isinstance(parent, ast.Assign):
            return any(_name_is_semantic(name) for target in parent.targets for name in _target_names(target))
        if isinstance(parent, ast.AnnAssign):
            return any(_name_is_semantic(name) for name in _target_names(parent.target))
        if isinstance(parent, ast.NamedExpr):
            return any(_name_is_semantic(name) for name in _target_names(parent.target))
        if isinstance(parent, ast.keyword) and parent.arg:
            return _name_is_semantic(parent.arg)
        return False


def check(root: Path) -> list[Violation]:
    dataplane_root = root / "apps" / "dataplane"
    governed_roots = (dataplane_root / "src", dataplane_root / "scripts")
    files = sorted(
        file
        for governed_root in governed_roots
        if governed_root.exists()
        for file in governed_root.rglob("*.py")
    )
    violations: list[Violation] = []
    for file in files:
        if "__pycache__" in file.parts:
            continue
        path = _path_text(file, root)
        try:
            tree = ast.parse(file.read_text(encoding="utf-8"), filename=path)
        except (OSError, SyntaxError) as error:
            violations.append(Violation(path, getattr(error, "lineno", 1) or 1, 1, "python-parse", str(error)))
            continue
        resolver = AliasResolver(tree)
        visitor = SemanticVisitor(path, resolver)
        visitor.visit(tree)
        violations.extend(visitor.violations)
    return sorted(set(violations))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Check Python semantic-value architecture rules")
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[2])
    arguments = parser.parse_args(argv)
    root = arguments.root.resolve()
    violations = check(root)
    if violations:
        print("Python semantic-value architecture check failed:")
        for item in violations:
            print(f"- {item.path}:{item.line}:{item.column} [{item.rule}] {item.message}")
        return 1
    print("Python semantic-value architecture check passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
