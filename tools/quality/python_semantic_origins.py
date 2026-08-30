from __future__ import annotations

import ast
import sys
from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path

Position = tuple[int, int]


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
    bases: tuple[ast.expr, ...] = ()
    conditional: bool = False
    definite_until: Position | None = None


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


class ScopeBuilder(ast.NodeVisitor):
    def __init__(self, tree: ast.Module) -> None:
        self.module_scope = Scope("module", None)
        self.scope = self.module_scope
        self.conditional_depth = 0
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
        *,
        binding_scope: Scope | None = None,
        position: Position | None = None,
    ) -> None:
        target_scope = binding_scope or self.scope
        if isinstance(target, ast.Name):
            target_scope.bind(
                target.id,
                Binding(
                    position or _after_position(owner),
                    value=value,
                    annotation=annotation,
                    conditional=self.conditional_depth > 0,
                ),
            )
        elif isinstance(target, (ast.Tuple, ast.List)):
            values = value.elts if isinstance(value, (ast.Tuple, ast.List)) else ()
            for index, child in enumerate(target.elts):
                child_value = values[index] if index < len(values) else None
                self._bind_target(
                    child,
                    owner,
                    child_value,
                    binding_scope=target_scope,
                    position=position,
                )

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
        self.scope.bind(
            node.name,
            Binding(_after_position(node), conditional=self.conditional_depth > 0),
        )
        parent = self.scope
        parent_conditional_depth = self.conditional_depth
        self.scope = Scope("function", parent)
        self.conditional_depth = 0
        try:
            self._bind_parameters(node.args)
            for statement in node.body:
                self.visit(statement)
        finally:
            self.scope = parent
            self.conditional_depth = parent_conditional_depth

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        self.visit_FunctionDef(node)  # type: ignore[arg-type]

    def visit_Lambda(self, node: ast.Lambda) -> None:
        self._visit_arguments_in_parent(node.args)
        parent = self.scope
        parent_conditional_depth = self.conditional_depth
        self.scope = Scope("function", parent)
        self.conditional_depth = 0
        try:
            self._bind_parameters(node.args)
            self.visit(node.body)
        finally:
            self.scope = parent
            self.conditional_depth = parent_conditional_depth

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        for base in node.bases:
            self.visit(base)
        for keyword in node.keywords:
            self.visit(keyword)
        for decorator in node.decorator_list:
            self.visit(decorator)
        self.scope.bind(
            node.name,
            Binding(
                _after_position(node),
                bases=tuple(node.bases),
                conditional=self.conditional_depth > 0,
            ),
        )
        parent = self.scope
        parent_conditional_depth = self.conditional_depth
        self.scope = Scope("class", parent)
        self.conditional_depth = 0
        try:
            for statement in node.body:
                self.visit(statement)
        finally:
            self.scope = parent
            self.conditional_depth = parent_conditional_depth

    def visit_Import(self, node: ast.Import) -> None:
        for alias in node.names:
            local = alias.asname or alias.name.split(".", 1)[0]
            module = alias.name if alias.asname else alias.name.split(".", 1)[0]
            self.scope.bind(
                local,
                Binding(
                    _after_position(node),
                    imported=ImportReference(module),
                    conditional=self.conditional_depth > 0,
                ),
            )

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
                    conditional=self.conditional_depth > 0,
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
        binding_scope = self.scope
        while binding_scope.kind == "comprehension" and binding_scope.parent is not None:
            binding_scope = binding_scope.parent
        self._bind_target(node.target, node, node.value, binding_scope=binding_scope)

    def visit_AugAssign(self, node: ast.AugAssign) -> None:
        self.visit(node.target)
        self.visit(node.value)
        self._bind_target(node.target, node)

    def visit_For(self, node: ast.For) -> None:
        self.visit(node.iter)
        self.conditional_depth += 1
        try:
            self.visit(node.target)
            self._bind_target(node.target, node)
            for statement in [*node.body, *node.orelse]:
                self.visit(statement)
        finally:
            self.conditional_depth -= 1

    def visit_AsyncFor(self, node: ast.AsyncFor) -> None:
        self.visit_For(node)  # type: ignore[arg-type]

    def _visit_conditionally(self, nodes: Iterable[ast.AST]) -> None:
        self.conditional_depth += 1
        try:
            for node in nodes:
                self.visit(node)
        finally:
            self.conditional_depth -= 1

    def visit_If(self, node: ast.If) -> None:
        self.visit(node.test)
        self._visit_conditionally(node.body)
        self._visit_conditionally(node.orelse)

    def visit_IfExp(self, node: ast.IfExp) -> None:
        self.visit(node.test)
        self.conditional_depth += 1
        try:
            self.visit(node.body)
            self.visit(node.orelse)
        finally:
            self.conditional_depth -= 1

    def visit_While(self, node: ast.While) -> None:
        self.visit(node.test)
        self._visit_conditionally(node.body)
        self._visit_conditionally(node.orelse)

    def visit_BoolOp(self, node: ast.BoolOp) -> None:
        if not node.values:
            return
        self.visit(node.values[0])
        self._visit_conditionally(node.values[1:])

    def visit_Compare(self, node: ast.Compare) -> None:
        self.visit(node.left)
        if not node.comparators:
            return
        self.visit(node.comparators[0])
        self._visit_conditionally(node.comparators[1:])

    def visit_Match(self, node: ast.Match) -> None:
        self.visit(node.subject)
        for case in node.cases:
            self.conditional_depth += 1
            try:
                self.visit(case.pattern)
                self._bind_match_pattern(
                    case.pattern,
                    node.subject,
                    _after_position(case.body[-1]),
                )
                if case.guard is not None:
                    self.visit(case.guard)
                for statement in case.body:
                    self.visit(statement)
            finally:
                self.conditional_depth -= 1

    def _bind_match_pattern(
        self,
        pattern: ast.pattern,
        subject: ast.expr | None,
        definite_until: Position,
    ) -> None:
        if isinstance(pattern, ast.MatchAs):
            if pattern.pattern is not None:
                self._bind_match_pattern(pattern.pattern, subject, definite_until)
            if pattern.name is not None:
                self.scope.bind(
                    pattern.name,
                    Binding(
                        _after_position(pattern),
                        value=subject,
                        conditional=True,
                        definite_until=definite_until,
                    ),
                )
            return
        if isinstance(pattern, ast.MatchOr):
            for alternative in pattern.patterns:
                self._bind_match_pattern(alternative, subject, definite_until)
            return
        if isinstance(pattern, ast.MatchSequence):
            for child in pattern.patterns:
                self._bind_match_pattern(child, None, definite_until)
            return
        if isinstance(pattern, ast.MatchMapping):
            for child in pattern.patterns:
                self._bind_match_pattern(child, None, definite_until)
            if pattern.rest is not None:
                self.scope.bind(
                    pattern.rest,
                    Binding(
                        _after_position(pattern),
                        conditional=True,
                        definite_until=definite_until,
                    ),
                )
            return
        if isinstance(pattern, ast.MatchClass):
            for child in [*pattern.patterns, *pattern.kwd_patterns]:
                self._bind_match_pattern(child, None, definite_until)
            return
        if isinstance(pattern, ast.MatchStar) and pattern.name is not None:
            self.scope.bind(
                pattern.name,
                Binding(
                    _after_position(pattern),
                    conditional=True,
                    definite_until=definite_until,
                ),
            )

    def _visit_comprehension(
        self,
        generators: list[ast.comprehension],
        values: Iterable[ast.expr],
    ) -> None:
        if not generators:
            for value in values:
                self.visit(value)
            return
        self.visit(generators[0].iter)
        parent = self.scope
        parent_conditional_depth = self.conditional_depth
        self.conditional_depth += 1
        try:
            for index, generator in enumerate(generators):
                if index > 0:
                    self.visit(generator.iter)
                self.scope = Scope("comprehension", self.scope)
                self.node_scopes[generator] = self.scope
                self.visit(generator.target)
                self._bind_target(generator.target, generator.target, position=(0, 0))
                for condition in generator.ifs:
                    self.visit(condition)
            for value in values:
                self.visit(value)
        finally:
            self.scope = parent
            self.conditional_depth = parent_conditional_depth

    def visit_ListComp(self, node: ast.ListComp) -> None:
        self._visit_comprehension(node.generators, [node.elt])

    def visit_SetComp(self, node: ast.SetComp) -> None:
        self._visit_comprehension(node.generators, [node.elt])

    def visit_DictComp(self, node: ast.DictComp) -> None:
        self._visit_comprehension(node.generators, [node.key, node.value])

    def visit_GeneratorExp(self, node: ast.GeneratorExp) -> None:
        self._visit_comprehension(node.generators, [node.elt])

    def visit_Try(self, node: ast.Try) -> None:
        self._visit_conditionally(node.body)
        self.conditional_depth += 1
        try:
            for handler in node.handlers:
                self.visit(handler)
        finally:
            self.conditional_depth -= 1
        self._visit_conditionally(node.orelse)
        for statement in node.finalbody:
            self.visit(statement)

    def visit_TryStar(self, node: ast.TryStar) -> None:
        self.visit_Try(node)  # type: ignore[arg-type]


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
        for base in binding.bases:
            result |= self.origins(base, next_seen)
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
                definite = [item for item in bindings if self._is_definite_at(item, position)]
                latest_position = max((item.position for item in definite), default=None)
                reachable = [
                    item
                    for item in bindings
                    if latest_position is None
                    or item.position == latest_position and self._is_definite_at(item, position)
                    or not self._is_definite_at(item, position) and item.position > latest_position
                ]
                result = frozenset()
                for binding in reachable:
                    result |= self._binding_origins(name, binding, seen)
                return result
            if name in current.local_names and current.kind == "function":
                return frozenset()
            current = current.parent
        if name == "float":
            return frozenset({"builtin:float"})
        return frozenset()

    @staticmethod
    def _is_definite_at(binding: Binding, position: Position) -> bool:
        return not binding.conditional or (
            binding.definite_until is not None and binding.position < position <= binding.definite_until
        )

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
            if "value:datetime.timedelta.total_seconds" in functions:
                return functions | {"value:datetime.timedelta.seconds"}
            return functions
        return frozenset()

    def is_timedelta_seconds_value(self, node: ast.expr) -> bool:
        return "value:datetime.timedelta.seconds" in self.origins(node)


def _is_timedelta_class(origin: str) -> bool:
    return origin in {"symbol:datetime.timedelta", "module:datetime.timedelta"}
