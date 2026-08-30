from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

VALID_DIGEST = "sha256:" + "a" * 64
OTHER_VALID_DIGEST = "sha256:" + "b" * 64


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


def test_replaces_only_named_image_digest_and_preserves_all_other_bytes_동작을_검증한다(
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
    "ambiguous_top_level",
    [
        '"images":',
        "'images':",
        "images :",
        "? images\n:",
        "images: &product-images",
        "images: *product-images",
        "images: !replace",
        '{"images": []}',
    ],
)
def test_거부한다_semantic_or_decorated_top_level_images_keys_without_mutation(
    tmp_path: Path,
    ambiguous_top_level: str,
) -> None:
    manifest = tmp_path / "kustomization.yaml"
    _write_manifest(
        manifest,
        _yaml(
            "images:",
            "  - name: eatbid-dataplane",
            "    digest: sha256:old",
            ambiguous_top_level,
            "  - name: eatbid-web",
            f"    digest: {OTHER_VALID_DIGEST}",
        ),
    )
    _assert_rejected_without_mutation(manifest)


def test_거부한다_multiple_yaml_documents_without_mutation(tmp_path: Path) -> None:
    manifest = tmp_path / "kustomization.yaml"
    _write_manifest(
        manifest,
        _yaml(
            "---",
            "images:",
            "  - name: eatbid-dataplane",
            "    digest: sha256:old",
            "---",
            "images:",
            "  - name: eatbid-web",
            f"    digest: {OTHER_VALID_DIGEST}",
        ),
    )
    _assert_rejected_without_mutation(manifest)


@pytest.mark.parametrize(
    "ambiguous_top_level",
    [
        '"im\\u0061ges":',
        "<<: *defaults",
        "defaults: &defaults",
        "release: !stable production",
        "metadata: {name: product}",
        "notes: |",
    ],
)
def test_거부한다_non_plain_top_level_grammar_without_mutation(
    tmp_path: Path,
    ambiguous_top_level: str,
) -> None:
    manifest = tmp_path / "kustomization.yaml"
    _write_manifest(
        manifest,
        _yaml(
            "images:",
            "  - name: eatbid-dataplane",
            "    digest: sha256:old",
            ambiguous_top_level,
        ),
    )
    _assert_rejected_without_mutation(manifest)


def test_거부한다_duplicate_unrelated_top_level_keys_without_mutation(
    tmp_path: Path,
) -> None:
    manifest = tmp_path / "kustomization.yaml"
    _write_manifest(
        manifest,
        _yaml(
            "kind: Kustomization",
            "images:",
            "  - name: eatbid-dataplane",
            "    digest: sha256:old",
            "kind: Kustomization",
        ),
    )
    _assert_rejected_without_mutation(manifest)


@pytest.mark.parametrize(
    "foreign_entry",
    [
        _yaml("  - name: eatbid-web"),
        _yaml("  - name: eatbid-web", "    newTag: latest", f"    digest: {OTHER_VALID_DIGEST}"),
        _yaml("  - name: eatbid-web", "    digest: sha256:old"),
        _yaml("  - name: eatbid-web", "    digest: sha256:" + "B" * 64),
        _yaml("  - name: eatbid-web", '    digest: "' + OTHER_VALID_DIGEST + '"'),
        _yaml("  - name: eatbid-web", "    digest: &web-digest " + OTHER_VALID_DIGEST),
        _yaml("  - name: eatbid-web", "    digest: *web-digest"),
        _yaml("  - name: eatbid-web", "    digest: !sha256 " + OTHER_VALID_DIGEST),
        _yaml('  - name: "eatbid-web"', f"    digest: {OTHER_VALID_DIGEST}"),
        _yaml("  - &web name: eatbid-web", f"    digest: {OTHER_VALID_DIGEST}"),
        _yaml("  - name: eatbid-web", "    unsupported: value", f"    digest: {OTHER_VALID_DIGEST}"),
        _yaml(
            "  - name: eatbid-web",
            f"    digest: {OTHER_VALID_DIGEST}",
            f"    digest: {OTHER_VALID_DIGEST}",
        ),
    ],
)
def test_검증한다_every_image_entry_before_mutating_target(
    tmp_path: Path,
    foreign_entry: str,
) -> None:
    manifest = tmp_path / "kustomization.yaml"
    _write_manifest(
        manifest,
        "images:\n"
        "  - name: eatbid-dataplane\n"
        "    digest: sha256:old\n"
        + foreign_entry,
    )
    _assert_rejected_without_mutation(manifest)


@pytest.mark.parametrize("invalid_value", [None, True, False, b"eatbid-dataplane", 1])
def test_거부한다_non_string_image_names_as_domain_errors(
    tmp_path: Path,
    invalid_value: object,
) -> None:
    from infra.update_image_digest import DigestUpdateError, update_digest

    manifest = tmp_path / "kustomization.yaml"
    before = _write_manifest(
        manifest,
        "images:\n  - name: eatbid-dataplane\n    digest: sha256:old\n",
    )
    with pytest.raises(DigestUpdateError):
        update_digest(manifest, invalid_value, VALID_DIGEST)  # type: ignore[arg-type]
    assert manifest.read_bytes() == before


@pytest.mark.parametrize("invalid_value", [None, True, False, b"sha256:bad", 1])
def test_거부한다_non_string_digests_as_domain_errors(
    tmp_path: Path,
    invalid_value: object,
) -> None:
    from infra.update_image_digest import DigestUpdateError, update_digest

    manifest = tmp_path / "kustomization.yaml"
    before = _write_manifest(
        manifest,
        "images:\n  - name: eatbid-dataplane\n    digest: sha256:old\n",
    )
    with pytest.raises(DigestUpdateError):
        update_digest(manifest, "eatbid-dataplane", invalid_value)  # type: ignore[arg-type]
    assert manifest.read_bytes() == before


@pytest.mark.parametrize("invalid_path", [None, True, False, b"manifest.yaml"])
def test_거부한다_invalid_paths_as_domain_errors(invalid_path: object) -> None:
    from infra.update_image_digest import DigestUpdateError, update_digest

    with pytest.raises(DigestUpdateError):
        update_digest(invalid_path, "eatbid-dataplane", VALID_DIGEST)  # type: ignore[arg-type]


def test_wraps_missing_and_directory_read_failures_and_cli_returns_two_동작을_검증한다(
    tmp_path: Path,
) -> None:
    from infra.update_image_digest import DigestUpdateError, main, update_digest

    missing = tmp_path / "missing.yaml"
    with pytest.raises(DigestUpdateError):
        update_digest(missing, "eatbid-dataplane", VALID_DIGEST)
    with pytest.raises(DigestUpdateError):
        update_digest(tmp_path, "eatbid-dataplane", VALID_DIGEST)
    assert main(["--file", str(missing), "eatbid-dataplane", VALID_DIGEST]) == 2


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
def test_거부한다_invalid_or_ambiguous_input_without_mutation(
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


def test_CLI_returns_exit_two_without_mutation_for_rejected_update_동작을_검증한다(
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
