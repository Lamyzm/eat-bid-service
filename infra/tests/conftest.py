from __future__ import annotations

import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

import pytest
import yaml

# `uv run --project apps/dataplane pytest infra/tests` executes pytest from the
# dataplane environment, whose console-script path does not automatically include
# the monorepo root on Windows. Keep local infrastructure modules importable in the
# exact command used by CI.
MONOREPO_ROOT = Path(__file__).parents[2]
if str(MONOREPO_ROOT) not in sys.path:
    sys.path.insert(0, str(MONOREPO_ROOT))
DATAPLANE_SRC = MONOREPO_ROOT / "apps" / "dataplane" / "src"
if str(DATAPLANE_SRC) not in sys.path:
    sys.path.insert(0, str(DATAPLANE_SRC))


@dataclass(frozen=True)
class ManifestSet:
    documents: tuple[dict[str, object], ...]

    @property
    def kinds(self) -> tuple[str, ...]:
        return tuple(str(document.get("kind")) for document in self.documents)

    def of_kind(self, kind: str) -> tuple[dict[str, object], ...]:
        return tuple(
            document for document in self.documents if document.get("kind") == kind
        )

    def named(self, kind: str, name: str) -> dict[str, object]:
        matches = tuple(
            document
            for document in self.of_kind(kind)
            if document.get("metadata", {}).get("name") == name
        )
        assert len(matches) == 1, (kind, name, len(matches))
        return matches[0]

    def workflow_template(self, name: str) -> dict[str, object]:
        return self.named("WorkflowTemplate", name)


def _render(path: Path) -> ManifestSet:
    result = subprocess.run(
        ["kubectl", "kustomize", str(path)],
        capture_output=True,
        check=True,
        text=True,
        encoding="utf-8",
    )
    documents = tuple(
        document
        for document in yaml.safe_load_all(result.stdout)
        if isinstance(document, dict)
    )
    return ManifestSet(documents)


@pytest.fixture(scope="session")
def manifests() -> ManifestSet:
    """운영이 실제로 받는 렌더다.

    `infra/product`를 계속 보는 이유는 Argo CD Application이 아직 그 경로를 보고 있기 때문이다. 전환이
    끝나면 이 fixture가 `infra/envs/prod`를 보고 별칭은 사라진다. 그 사이 둘이 같은 것을 낸다는 사실은
    `test_env_overlays.py`가 지킨다.
    """
    return _render(MONOREPO_ROOT / "infra" / "product")


@pytest.fixture(scope="session")
def prod_manifests() -> ManifestSet:
    return _render(MONOREPO_ROOT / "infra" / "envs" / "prod")


@pytest.fixture(scope="session")
def dev_manifests() -> ManifestSet:
    return _render(MONOREPO_ROOT / "infra" / "envs" / "dev")


@pytest.fixture(scope="session")
def base_manifests() -> ManifestSet:
    return _render(MONOREPO_ROOT / "infra" / "base")
