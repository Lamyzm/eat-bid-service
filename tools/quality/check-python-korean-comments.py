"""모듈 책임: Python production 파일의 첫 docstring에 한국어 책임 설명이 있는지 판정한다."""

from __future__ import annotations

import ast
import json
import re
import sys
from pathlib import Path

HANGUL = re.compile(r"[가-힣]")
GENERIC = re.compile(
    r"^(?:이\s*)?(?:모듈|코드|기능|해당\s*코드)(?:을|를)?\s*(?:설명|담당)(?:한다|합니다)?[.!]?$"
)


def meaningful(description: str) -> bool:
    text = " ".join(description.split()).strip()
    return len(HANGUL.findall(text)) >= 6 and GENERIC.fullmatch(text) is None


def inspect_file(repo_root: Path, relative_path: str) -> dict[str, object]:
    target = (repo_root / relative_path).resolve()
    try:
        target.relative_to(repo_root)
        source = target.read_text(encoding="utf-8")
        module = ast.parse(source, filename=relative_path)
    except (OSError, SyntaxError, UnicodeError, ValueError) as error:
        return {
            "path": relative_path,
            "valid": False,
            "message": f"Python module을 읽을 수 없습니다: {type(error).__name__}",
        }

    docstring = ast.get_docstring(module, clean=False)
    if not docstring or not docstring.lstrip().startswith("모듈 책임:"):
        return {
            "path": relative_path,
            "valid": False,
            "message": "첫 module docstring에 '모듈 책임:' 설명이 필요합니다.",
        }
    description = docstring.lstrip().removeprefix("모듈 책임:").strip()
    if not meaningful(description):
        return {
            "path": relative_path,
            "valid": False,
            "message": "module 책임은 구체적인 한국어 문장으로 작성해야 합니다.",
        }
    return {"path": relative_path, "valid": True, "message": None}


def main() -> None:
    request = json.load(sys.stdin)
    repo_root = Path(request["repoRoot"]).resolve()
    results = [inspect_file(repo_root, path) for path in request["paths"]]
    json.dump({"results": results}, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
