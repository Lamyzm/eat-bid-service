from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

VALID_DIGEST = "sha256:" + "a" * 64


def _yaml(*lines: str) -> str:
    return "\n".join(lines) + "\n"


def _write_manifest(path: Path, text: str) -> bytes:
    content = text.encode("utf-8")
    path.write_bytes(content)
    return content


def _assert_rejected_without_mutation(
    manifest: Path,
    *,
    image_name: str = "eatbid-dataplane",
    digest: str = VALID_DIGEST,
) -> None:
    from infra.update_image_digest import DigestUpdateError, main, update_digest

    before = manifest.read_bytes()
    with pytest.raises(DigestUpdateError):
        update_digest(manifest, image_name, digest)
    assert manifest.read_bytes() == before
    assert (
        main(["--file", str(manifest), image_name, digest]) == 2
    )
    assert manifest.read_bytes() == before


def test_replaces_only_named_image_digest_and_preserves_all_other_bytes(
    tmp_path: Path,
) -> None:
    from infra.update_image_digest import update_digest

    manifest = tmp_path / "kustomization.yaml"
    _write_manifest(
        manifest,
        "apiVersion: kustomize.config.k8s.io/v1beta1\r\n"
        "kind: Kustomization\r\n"
        "images:\r\n"
        "  - name: eatbid-server\r\n"
        "    newName: ghcr.io/lamyzm/eatbid-server\r\n"
        "    digest: sha256:" + "1" * 64 + " # server\r\n"
        "  - name: eatbid-dataplane\r\n"
        "    newName: ghcr.io/lamyzm/eatbid-dataplane\r\n"
        "    digest: sha256:old # replace only this scalar\r\n"
        "resources:\r\n"
        "  - ../k8s/base\r\n",
    )

    update_digest(manifest, "eatbid-dataplane", VALID_DIGEST)

    expected = (
        "apiVersion: kustomize.config.k8s.io/v1beta1\r\n"
        "kind: Kustomization\r\n"
        "images:\r\n"
        "  - name: eatbid-server\r\n"
        "    newName: ghcr.io/lamyzm/eatbid-server\r\n"
        "    digest: sha256:" + "1" * 64 + " # server\r\n"
        "  - name: eatbid-dataplane\r\n"
        "    newName: ghcr.io/lamyzm/eatbid-dataplane\r\n"
        f"    digest: {VALID_DIGEST} # replace only this scalar\r\n"
        "resources:\r\n"
        "  - ../k8s/base\r\n"
    ).encode("utf-8")
    assert manifest.read_bytes() == expected


@pytest.mark.parametrize(
    ("manifest_text", "image_name", "digest"),
    [
        (
            "images:\n  - name: eatbid-web\n    digest: sha256:old\n",
            "eatbid-dataplane",
            VALID_DIGEST,
        ),
        (
            _yaml(
                "images:",
                "  - name: eatbid-dataplane",
                "    digest: sha256:old",
                "  - name: eatbid-dataplane",
                "    digest: sha256:other",
            ),
            "eatbid-dataplane",
            VALID_DIGEST,
        ),
        (
            _yaml(
                "images:",
                "  - name: eatbid-dataplane",
                "    digest: sha256:old",
                "    digest: sha256:duplicate",
            ),
            "eatbid-dataplane",
            VALID_DIGEST,
        ),
        (
            _yaml(
                "images:",
                "  - name: eatbid-dataplane",
                "    newTag: latest",
                "    digest: sha256:old",
            ),
            "eatbid-dataplane",
            VALID_DIGEST,
        ),
        (
            "images:\n  - name: eatbid-dataplane\n    digest: sha256:old\n",
            "eatbid-dataplane:latest",
            VALID_DIGEST,
        ),
        (
            "images:\n  - name: eatbid-dataplane\n    digest: sha256:old\n",
            "eatbid-dataplane",
            "latest",
        ),
        (
            "images:\n  - name: eatbid-dataplane\n    digest: sha256:old\n",
            "eatbid-dataplane",
            "sha256:" + "A" * 64,
        ),
        (
            "images:\n  - name: eatbid-dataplane\n    digest: sha256:old\n",
            "eatbid-dataplane",
            "sha256:" + "a" * 63,
        ),
        (
            "images:\n  - {name: eatbid-dataplane, digest: sha256:old}\n",
            "eatbid-dataplane",
            VALID_DIGEST,
        ),
        (
            _yaml(
                "images:",
                "  - name: eatbid-dataplane",
                "    digest: sha256:old",
                "images:",
                "  - name: eatbid-web",
                "    digest: sha256:old",
            ),
            "eatbid-dataplane",
            VALID_DIGEST,
        ),
        (
            _yaml(
                "images: &product-images",
                "  - name: eatbid-dataplane",
                "    digest: sha256:old",
            ),
            "eatbid-dataplane",
            VALID_DIGEST,
        ),
        (
            _yaml(
                "images:",
                "  - name: eatbid-dataplane",
                "      digest: sha256:old",
            ),
            "eatbid-dataplane",
            VALID_DIGEST,
        ),
        (
            _yaml(
                "images:",
                "  - name: eatbid-dataplane",
                '    digest: "sha256:old"',
            ),
            "eatbid-dataplane",
            VALID_DIGEST,
        ),
    ],
)
def test_rejects_invalid_or_ambiguous_input_without_mutation(
    tmp_path: Path,
    manifest_text: str,
    image_name: str,
    digest: str,
) -> None:
    manifest = tmp_path / "kustomization.yaml"
    _write_manifest(manifest, manifest_text)
    _assert_rejected_without_mutation(
        manifest,
        image_name=image_name,
        digest=digest,
    )


def test_cli_returns_exit_two_without_mutation_for_rejected_update(
    tmp_path: Path,
) -> None:
    manifest = tmp_path / "kustomization.yaml"
    before = _write_manifest(
        manifest,
        "images:\n  - name: eatbid-web\n    digest: sha256:old\n",
    )
    script = Path(__file__).parents[1] / "update_image_digest.py"

    result = subprocess.run(
        [
            sys.executable,
            str(script),
            "--file",
            str(manifest),
            "eatbid-dataplane",
            VALID_DIGEST,
        ],
        capture_output=True,
        check=False,
        text=True,
    )

    assert result.returncode == 2
    assert manifest.read_bytes() == before
