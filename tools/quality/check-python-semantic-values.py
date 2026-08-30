from __future__ import annotations

import argparse
import ast
import re
import sys
from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path

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
GENERATED_MODEL = "apps/dataplane/src/eatbid/generated/ingestion_v1.py"
Position = tuple[int, int]


@dataclass(frozen=True, order=True)
class Violation:
    path: str
    line: int
    column: int
    rule: str
    message: str


@dataclass(frozen=True)
class ImportReference:
    module: str
    symbol: str | None = None
    level: int = 0


@dataclass(frozen=True)
class Binding:
    position: Position
    value: ast.expr | None = None
    imported: ImportReference | None = None
    annotation: ast.expr | None = None


@dataclass
class Scope:
    kind: str
    parent: Scope | None
    bindings: dict[str, list[Binding]] = field(default_factory=dict)
    local_names: set[str] = field(default_factory=set)

    def bind(self, name: str, binding: Binding) -> None:
        self.local_names.add(name)
        self.bindings.setdefault(name, []).append(binding)


def _position(node: ast.AST) -> Position:
    return (getattr(node, "lineno", 0), getattr(node, "col_offset", 0))


def _after_position(node: ast.AST) -> Position:
    return (
        getattr(node, "end_lineno", getattr(node, "lineno", 0)),
        getattr(node, "end_col_offset", getattr(node, "col_offset", 0)),
    )


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


class ScopeBuilder(ast.NodeVisitor):
    def __init__(self, tree: ast.Module) -> None:
        self.module_scope = Scope("module", None)
        self.scope = self.module_scope
        self.node_scopes: dict[ast.AST, Scope] = {}
        self.visit(tree)

    def visit(self, node: ast.AST) -> None:
        self.node_scopes[node] = self.scope
        super().visit(node)

    def _bind_target(
        self,
        target: ast.expr,
        owner: ast.AST,
        value: ast.expr | None = None,
        annotation: ast.expr | None = None,
    ) -> None:
        if isinstance(target, ast.Name):
            self.scope.bind(target.id, Binding(_after_position(owner), value=value, annotation=annotation))
        elif isinstance(target, (ast.Tuple, ast.List)):
            values = value.elts if isinstance(value, (ast.Tuple, ast.List)) else ()
            for index, child in enumerate(target.elts):
                child_value = values[index] if index < len(values) else None
                self._bind_target(child, owner, child_value)

    def _visit_arguments_in_parent(self, arguments: ast.arguments) -> None:
        for default in [*arguments.defaults, *arguments.kw_defaults]:
            if default is not None:
                self.visit(default)
        for argument in [*arguments.posonlyargs, *arguments.args, *arguments.kwonlyargs]:
            if argument.annotation is not None:
                self.visit(argument.annotation)
        if arguments.vararg and arguments.vararg.annotation:
            self.visit(arguments.vararg.annotation)
        if arguments.kwarg and arguments.kwarg.annotation:
            self.visit(arguments.kwarg.annotation)

    def _bind_parameters(self, arguments: ast.arguments) -> None:
        parameters = [*arguments.posonlyargs, *arguments.args, *arguments.kwonlyargs]
        if arguments.vararg:
            parameters.append(arguments.vararg)
        if arguments.kwarg:
            parameters.append(arguments.kwarg)
        for argument in parameters:
            self.node_scopes[argument] = self.scope
            self.scope.bind(argument.arg, Binding((0, 0), annotation=argument.annotation))

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        for decorator in node.decorator_list:
            self.visit(decorator)
        self._visit_arguments_in_parent(node.args)
        if node.returns:
            self.visit(node.returns)
        self.scope.bind(node.name, Binding(_after_position(node)))
        parent = self.scope
        self.scope = Scope("function", parent)
        self._bind_parameters(node.args)
        for statement in node.body:
            self.visit(statement)
        self.scope = parent

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        self.visit_FunctionDef(node)  # type: ignore[arg-type]

    def visit_Lambda(self, node: ast.Lambda) -> None:
        self._visit_arguments_in_parent(node.args)
        parent = self.scope
        self.scope = Scope("function", parent)
        self._bind_parameters(node.args)
        self.visit(node.body)
        self.scope = parent

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        for base in node.bases:
            self.visit(base)
        for keyword in node.keywords:
            self.visit(keyword)
        for decorator in node.decorator_list:
            self.visit(decorator)
        self.scope.bind(node.name, Binding(_after_position(node)))
        parent = self.scope
        self.scope = Scope("class", parent)
        for statement in node.body:
            self.visit(statement)
        self.scope = parent

    def visit_Import(self, node: ast.Import) -> None:
        for alias in node.names:
            local = alias.asname or alias.name.split(".", 1)[0]
            module = alias.name if alias.asname else alias.name.split(".", 1)[0]
            self.scope.bind(local, Binding(_after_position(node), imported=ImportReference(module)))

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        if node.module is None and node.level == 0:
            return
        for alias in node.names:
            if alias.name == "*":
                continue
            local = alias.asname or alias.name
            self.scope.bind(
                local,
                Binding(
                    _after_position(node),
                    imported=ImportReference(node.module or "", alias.name, node.level),
                ),
            )

    def visit_Assign(self, node: ast.Assign) -> None:
        self.visit(node.value)
        for target in node.targets:
            self.visit(target)
            self._bind_target(target, node, node.value)

    def visit_AnnAssign(self, node: ast.AnnAssign) -> None:
        self.visit(node.annotation)
        if node.value:
            self.visit(node.value)
        self.visit(node.target)
        self._bind_target(node.target, node, node.value, node.annotation)

    def visit_NamedExpr(self, node: ast.NamedExpr) -> None:
        self.visit(node.value)
        self.visit(node.target)
        self._bind_target(node.target, node, node.value)

    def visit_AugAssign(self, node: ast.AugAssign) -> None:
        self.visit(node.target)
        self.visit(node.value)
        self._bind_target(node.target, node)

    def visit_For(self, node: ast.For) -> None:
        self.visit(node.iter)
        self.visit(node.target)
        self._bind_target(node.target, node)
        for statement in [*node.body, *node.orelse]:
            self.visit(statement)

    def visit_AsyncFor(self, node: ast.AsyncFor) -> None:
        self.visit_For(node)  # type: ignore[arg-type]


class ProjectResolver:
    def __init__(self, roots: tuple[Path, ...], files: list[Path], trees: dict[Path, ast.Module]) -> None:
        self.roots = roots
        self.modules: dict[str, AliasResolver] = {}
        self.resolvers_by_path: dict[Path, AliasResolver] = {}
        for file in files:
            module_name, is_package = self._module_identity(file)
            resolver = AliasResolver(self, module_name, is_package, trees[file])
            self.modules[module_name] = resolver
            self.resolvers_by_path[file] = resolver

    def _module_identity(self, file: Path) -> tuple[str, bool]:
        for root in self.roots:
            try:
                relative = file.relative_to(root)
            except ValueError:
                continue
            parts = list(relative.with_suffix("").parts)
            is_package = parts[-1] == "__init__"
            if is_package:
                parts.pop()
            return ".".join(parts), is_package
        raise ValueError(f"file is outside governed roots: {file}")

    def resolve_import(
        self,
        current_module: str,
        current_is_package: bool,
        reference: ImportReference,
        seen: frozenset[tuple[str, str, int]],
    ) -> frozenset[str]:
        module = reference.module
        if reference.level:
            module_parts = current_module.split(".")
            package = module_parts if current_is_package else module_parts[:-1]
            keep = max(0, len(package) - reference.level + 1)
            module = ".".join([*package[:keep], *([module] if module else [])])
        if reference.symbol is None:
            return frozenset({f"module:{module}"})
        local = self.modules.get(module)
        if local is not None:
            return local.resolve_export(reference.symbol, seen)
        return frozenset({f"symbol:{module}.{reference.symbol}"})


class AliasResolver:
    """Resolve lexical bindings at the use site and follow local re-exports."""

    def __init__(
        self,
        project: ProjectResolver,
        module_name: str,
        is_package: bool,
        tree: ast.Module,
    ) -> None:
        self.project = project
        self.module_name = module_name
        self.is_package = is_package
        builder = ScopeBuilder(tree)
        self.module_scope = builder.module_scope
        self.node_scopes = builder.node_scopes

    def resolve_export(
        self,
        name: str,
        seen: frozenset[tuple[str, str, int]],
    ) -> frozenset[str]:
        return self._resolve_name(name, self.module_scope, (sys.maxsize, sys.maxsize), seen)

    def _binding_origins(
        self,
        name: str,
        binding: Binding,
        seen: frozenset[tuple[str, str, int]],
    ) -> frozenset[str]:
        key = (self.module_name, name, id(binding))
        if key in seen:
            return frozenset()
        next_seen = seen | {key}
        if binding.imported:
            return self.project.resolve_import(
                self.module_name,
                self.is_package,
                binding.imported,
                next_seen,
            )
        result = frozenset()
        if binding.value is not None:
            result |= self.origins(binding.value, next_seen)
        if binding.annotation is not None:
            annotation_origins = self.origins(binding.annotation, next_seen)
            if any(_is_timedelta_class(origin) for origin in annotation_origins):
                result |= frozenset({"value:datetime.timedelta"})
        return result

    def _resolve_name(
        self,
        name: str,
        scope: Scope | None,
        position: Position,
        seen: frozenset[tuple[str, str, int]],
    ) -> frozenset[str]:
        current = scope
        while current is not None:
            bindings = [item for item in current.bindings.get(name, []) if item.position < position]
            if bindings:
                latest_position = max(item.position for item in bindings)
                result = frozenset()
                for binding in bindings:
                    if binding.position == latest_position:
                        result |= self._binding_origins(name, binding, seen)
                return result
            if name in current.local_names and current.kind == "function":
                return frozenset()
            current = current.parent
        if name == "float":
            return frozenset({"builtin:float"})
        return frozenset()

    def origins(
        self,
        node: ast.expr,
        seen: frozenset[tuple[str, str, int]] = frozenset(),
    ) -> frozenset[str]:
        if isinstance(node, ast.Name):
            scope = self.node_scopes.get(node, self.module_scope)
            return self._resolve_name(node.id, scope, _position(node), seen)
        if isinstance(node, ast.Attribute):
            bases = self.origins(node.value, seen)
            return frozenset(f"{base}.{node.attr}" for base in bases)
        if isinstance(node, ast.IfExp):
            return self.origins(node.body, seen) | self.origins(node.orelse, seen)
        if isinstance(node, ast.BoolOp):
            result = frozenset()
            for value in node.values:
                result |= self.origins(value, seen)
            return result
        if isinstance(node, ast.Call):
            functions = self.origins(node.func, seen)
            if any(_is_timedelta_class(origin) for origin in functions):
                return functions | {"value:datetime.timedelta"}
            return functions
        return frozenset()

    def is_timedelta_value(self, node: ast.expr) -> bool:
        return "value:datetime.timedelta" in self.origins(node)


def _is_datetime_class(origin: str) -> bool:
    return origin in {"symbol:datetime.datetime", "module:datetime.datetime"}


def _is_timedelta_class(origin: str) -> bool:
    return origin in {"symbol:datetime.timedelta", "module:datetime.timedelta"}


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
            named_duration = (
                isinstance(argument, ast.Call)
                and isinstance(argument.func, ast.Attribute)
                and argument.func.attr == "total_seconds"
                and self.resolver.is_timedelta_value(argument.func.value)
            )
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
