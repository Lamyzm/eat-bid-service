"""모듈 책임: dataplane Python 소스에서 금액·비율 값이 float나 손으로 쓴 정규화 Pydantic 모델을
통과하지 않는지, naive datetime과 raw sleep 값이 남지 않았는지 AST로 검사한다. 손 작성 모델 금지
규칙의 예외는 `generate_contract_models.py`의 `CONTRACTS` 목록에서 파생한 정확 경로 집합으로만
둔다 — 디렉터리 전체를 면제하면 등록되지 않은 파일도 검사를 피해 가므로 생성기가 실제로 쓰는
파일명만 예외로 인정한다.
"""

from __future__ import annotations

import argparse
import ast
import importlib.util
import re
import sys
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

from python_semantic_origins import AliasResolver, ProjectResolver

SEMANTIC_TOKENS = {
    "amount",
    "money",
    "price",
    "rate",
    "ratio",
    "percent",
    "percentage",
}
SOURCE_MODEL_PREFIX = "apps/dataplane/src/eatbid/source/"
REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
GENERATOR_SCRIPT = REPOSITORY_ROOT / "apps" / "dataplane" / "scripts" / "generate_contract_models.py"


def _load_generated_model_paths(generator_script: Path, repository_root: Path) -> frozenset[str]:
    """생성기 스크립트를 모듈로 로드해 `CONTRACTS`의 출력 경로만 정확히 예외로 인정한다.

    이 스크립트를 `__main__`으로 만들지 않도록 고유한 모듈 이름으로 적재한다 — 그래야 파일 하단의
    `if __name__ == "__main__":` 가드가 datamodel-codegen을 실행시키지 않는다.
    """
    spec = importlib.util.spec_from_file_location("_eatbid_generate_contract_models", generator_script)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"{generator_script} 을(를) 모듈로 불러오지 못했습니다")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return frozenset(
        output_path.resolve().relative_to(repository_root).as_posix() for _, output_path in module.CONTRACTS
    )


GENERATED_MODEL_PATHS = _load_generated_model_paths(GENERATOR_SCRIPT, REPOSITORY_ROOT)


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
    snake = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", name).lower()
    return any(token in SEMANTIC_TOKENS for token in re.findall(r"[a-z]+", snake))


def _literal_none(node: ast.expr | None) -> bool:
    return node is None or isinstance(node, ast.Constant) and node.value is None


def _target_names(node: ast.expr) -> Iterable[str]:
    if isinstance(node, ast.Name):
        yield node.id
    elif isinstance(node, ast.Attribute):
        yield node.attr
    elif isinstance(node, (ast.Tuple, ast.List)):
        for item in node.elts:
            yield from _target_names(item)


def _is_datetime_class(origin: str) -> bool:
    return origin in {"symbol:datetime.datetime", "module:datetime.datetime"}


def _is_datetime_method(origin: str, method: str) -> bool:
    return origin in {
        f"symbol:datetime.datetime.{method}",
        f"module:datetime.datetime.{method}",
    }


def _is_builtin_float(origin: str) -> bool:
    return origin in {"builtin:float", "module:builtins.float", "symbol:builtins.float"}


def _has_non_none_timezone(call: ast.Call, keyword: str = "tz") -> bool:
    if call.args and not _literal_none(call.args[0]):
        return True
    return any(item.arg in {keyword, "tzinfo"} and not _literal_none(item.value) for item in call.keywords)


def _annotation_contains_float(node: ast.expr, resolver: AliasResolver) -> bool:
    if any(_is_builtin_float(origin) for origin in resolver.origins(node)):
        return True
    return any(
        _annotation_contains_float(child, resolver)
        for child in ast.iter_child_nodes(node)
        if isinstance(child, ast.expr)
    )


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
        self.violations.append(
            Violation(
                self.path,
                getattr(node, "lineno", 1),
                getattr(node, "col_offset", 0) + 1,
                rule,
                message,
            )
        )

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        allowed_model = self.path.startswith(SOURCE_MODEL_PREFIX) or self.path in GENERATED_MODEL_PATHS
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
            has_tzinfo = len(node.args) > 7 and not _literal_none(node.args[7])
            has_tzinfo |= any(item.arg == "tzinfo" and not _literal_none(item.value) for item in node.keywords)
            if not has_tzinfo:
                self.report(node, "naive-datetime", "datetime construction must provide an explicit tzinfo")
        elif any(_is_datetime_method(origin, "now") for origin in origins):
            if not _has_non_none_timezone(node):
                self.report(node, "naive-datetime", "datetime.now() must receive an explicit timezone")
        elif any(_is_datetime_method(origin, "utcnow") for origin in origins):
            self.report(node, "naive-datetime", "datetime.utcnow() returns a naive datetime")
        elif any(_is_datetime_method(origin, "utcfromtimestamp") for origin in origins):
            self.report(node, "naive-datetime", "datetime.utcfromtimestamp() returns a naive datetime")
        elif any(_is_datetime_method(origin, "fromtimestamp") for origin in origins):
            timezone_argument = len(node.args) > 1 and not _literal_none(node.args[1])
            timezone_keyword = any(item.arg == "tz" and not _literal_none(item.value) for item in node.keywords)
            if not timezone_argument and not timezone_keyword:
                self.report(node, "naive-datetime", "datetime.fromtimestamp() must receive a timezone")

        sleep_origins = {
            "symbol:time.sleep",
            "module:time.sleep",
            "symbol:asyncio.sleep",
            "module:asyncio.sleep",
        }
        if any(origin in sleep_origins for origin in origins):
            argument = node.args[0] if node.args else None
            named_duration = argument is not None and self.resolver.is_timedelta_seconds_value(argument)
            if not named_duration:
                self.report(node, "raw-sleep-value", "sleep duration must come from a named timedelta conversion")

        if any(_is_builtin_float(origin) for origin in origins) and self._call_feeds_semantic_value(node):
            self.report(node, "float-semantic-value", "money and rate normalization must not convert through float")
        self.generic_visit(node)

    def _call_feeds_semantic_value(self, node: ast.Call) -> bool:
        for parent in reversed(self.parents[:-1]):
            if isinstance(parent, ast.Assign):
                return any(_name_is_semantic(name) for target in parent.targets for name in _target_names(target))
            if isinstance(parent, ast.AnnAssign):
                return any(_name_is_semantic(name) for name in _target_names(parent.target))
            if isinstance(parent, ast.NamedExpr):
                return any(_name_is_semantic(name) for name in _target_names(parent.target))
            if isinstance(parent, ast.keyword) and parent.arg and _name_is_semantic(parent.arg):
                return True
            if isinstance(parent, ast.Dict):
                for key, value in zip(parent.keys, parent.values, strict=False):
                    if (
                        value is not None
                        and node in ast.walk(value)
                        and isinstance(key, ast.Constant)
                        and isinstance(key.value, str)
                        and _name_is_semantic(key.value)
                    ):
                        return True
            if isinstance(parent, (ast.stmt, ast.Lambda)):
                return False
        return False


def check(root: Path) -> list[Violation]:
    dataplane_root = root / "apps" / "dataplane"
    governed_roots = (dataplane_root / "src", dataplane_root / "scripts")
    files = sorted(
        file
        for governed_root in governed_roots
        if governed_root.exists()
        for file in governed_root.rglob("*.py")
        if "__pycache__" not in file.parts
    )
    trees: dict[Path, ast.Module] = {}
    violations: list[Violation] = []
    for file in files:
        path = _path_text(file, root)
        try:
            trees[file] = ast.parse(file.read_text(encoding="utf-8"), filename=path)
        except (OSError, SyntaxError) as error:
            violations.append(Violation(path, getattr(error, "lineno", 1) or 1, 1, "python-parse", str(error)))
    project = ProjectResolver(governed_roots, list(trees), trees)
    for file, tree in trees.items():
        path = _path_text(file, root)
        visitor = SemanticVisitor(path, project.resolvers_by_path[file])
        visitor.visit(tree)
        violations.extend(visitor.violations)
    return sorted(set(violations))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Check Python semantic-value architecture rules")
    parser.add_argument("--root", type=Path, default=REPOSITORY_ROOT)
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
