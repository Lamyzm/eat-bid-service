from __future__ import annotations

import ast
import json
import sys
from pathlib import Path


EXCLUDED_DIRECTORIES = {
    ".git",
    ".next",
    ".turbo",
    ".venv",
    "__pycache__",
    "dist",
    "node_modules",
}


def contains_hangul_syllable(value: str) -> bool:
    return any("가" <= character <= "힣" for character in value)


def has_meaningful_korean_behavior(name: str) -> bool:
    stem = name.removeprefix("test_")
    if stem in {
        "검증",
        "검증한다",
        "동작_검증",
        "동작을_검증한다",
        "행위_검증",
        "행위를_검증한다",
        "확인",
        "확인한다",
    } or stem.endswith("_동작을_검증한다"):
        return False
    final_word = stem.rsplit("_", maxsplit=1)[-1]
    return contains_hangul_syllable(final_word)


def python_files(root: Path) -> list[Path]:
    return sorted(
        path
        for path in root.rglob("*.py")
        if not any(part in EXCLUDED_DIRECTORIES for part in path.relative_to(root).parts)
    )


def main() -> int:
    root = Path(sys.argv[1]).resolve()
    violations: list[dict[str, object]] = []
    declaration_count = 0

    for path in python_files(root):
        relative_path = path.relative_to(root).as_posix()
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=relative_path)
        except (OSError, SyntaxError, UnicodeError) as error:
            violations.append(
                {
                    "file": relative_path,
                    "line": getattr(error, "lineno", 1) or 1,
                    "message": f"Python AST를 읽을 수 없습니다: {type(error).__name__}",
                }
            )
            continue

        for node in ast.walk(tree):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            if not node.name.startswith("test_"):
                continue
            declaration_count += 1
            if not contains_hangul_syllable(node.name):
                violations.append(
                    {
                        "file": relative_path,
                        "line": node.lineno,
                        "message": f"pytest 함수명에 한글 음절이 없습니다: {node.name}",
                    }
                )
            elif not has_meaningful_korean_behavior(node.name):
                violations.append(
                    {
                        "file": relative_path,
                        "line": node.lineno,
                        "message": f"구체적인 한국어 행위가 없는 pytest 함수명입니다: {node.name}",
                    }
                )

    print(
        json.dumps(
            {"declarationCount": declaration_count, "violations": violations},
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
