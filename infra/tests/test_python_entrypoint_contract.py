from __future__ import annotations

import subprocess
from pathlib import Path

ROOT = Path(__file__).parents[2]


def test_셸_진입점인_파이썬만_git_실행_권한을_가진다() -> None:
    tracked = subprocess.run(
        ["git", "ls-files", "--stage", "infra/*.py"],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.splitlines()

    mismatches: list[str] = []
    for entry in tracked:
        metadata, relative_path = entry.split("\t", maxsplit=1)
        mode = metadata.split(maxsplit=1)[0]
        has_shebang = (ROOT / relative_path).read_bytes().startswith(b"#!")
        if has_shebang != (mode == "100755"):
            mismatches.append(f"{relative_path}: mode={mode}, shebang={has_shebang}")

    assert mismatches == []
