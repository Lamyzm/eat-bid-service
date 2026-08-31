from __future__ import annotations

import json
from pathlib import Path

import pytest

ROOT = Path(__file__).parents[2]


@pytest.mark.parametrize(
    ("dockerfile", "manifest_copy", "source_copy"),
    [
        (
            "Dockerfile.server",
            "COPY packages/domain ./packages/domain",
            "COPY packages/domain ./packages/domain",
        ),
        (
            "packages/db/Dockerfile",
            "COPY packages/domain/package.json packages/domain/package.json",
            "COPY packages/domain packages/domain",
        ),
    ],
)
def test_node_이미지는_workspace_의존성을_설치와_빌드_전에_복사한다(
    dockerfile: str,
    manifest_copy: str,
    source_copy: str,
) -> None:
    text = (ROOT / dockerfile).read_text(encoding="utf-8")

    assert text.index(manifest_copy) < text.index("RUN pnpm install")
    assert text.index(source_copy) < text.index("RUN pnpm --filter")


def test_workspace_의존성_강제버전은_루트에서_단일관리한다() -> None:
    root_package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    web_package = json.loads(
        (ROOT / "apps/web/package.json").read_text(encoding="utf-8")
    )

    assert root_package["pnpm"]["overrides"]["sharp"] == "^0.35.3"
    assert "overrides" not in web_package
