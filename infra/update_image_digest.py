#!/usr/bin/env python3
"""Atomically replace one digest in a strict Kustomize images block."""

from __future__ import annotations

import argparse
import os
import re
import stat
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

DIGEST_PATTERN = re.compile(r"sha256:[0-9a-f]{64}\Z")
IMAGE_NAME_PATTERN = re.compile(r"[a-z0-9]+(?:[._/-][a-z0-9]+)*\Z")
IMAGES_HEADER_PATTERN = re.compile(r"^images:[ ]*(?:#.*)?(?:\r?\n)?$")
ENTRY_PATTERN = re.compile(
    r"^(?P<indent> +)- +name: +(?P<value>[^ #\t\r\n]+)(?: +#.*)?(?:\r?\n)?$"
)
FIELD_PATTERN = re.compile(
    r"^(?P<indent> +)(?P<key>[A-Za-z][A-Za-z0-9]*): +"
    r"(?P<value>[^ #\t\r\n]+)(?: +#.*)?(?:\r?\n)?$"
)
ALLOWED_FIELDS = frozenset({"newName", "newTag", "digest"})


class DigestUpdateError(ValueError):
    """The requested update is unsafe or the manifest is structurally ambiguous."""


@dataclass(frozen=True)
class _Field:
    key: str
    value: str
    line_index: int


@dataclass(frozen=True)
class _Image:
    name: str
    fields: tuple[_Field, ...]


def _fail(message: str) -> DigestUpdateError:
    return DigestUpdateError(message)


def _parse_images(lines: list[str]) -> list[_Image]:
    if any("\t" in line for line in lines):
        raise _fail("tabs are not accepted in the images block")

    header_indexes = [
        index for index, line in enumerate(lines) if IMAGES_HEADER_PATTERN.fullmatch(line)
    ]
    if len(header_indexes) != 1:
        raise _fail("manifest must contain exactly one plain top-level images block")

    start = header_indexes[0] + 1
    end = len(lines)
    for index in range(start, len(lines)):
        stripped = lines[index].strip()
        if stripped and not stripped.startswith("#") and not lines[index].startswith(" "):
            end = index
            break

    images: list[_Image] = []
    current_name: str | None = None
    current_indent: int | None = None
    current_fields: list[_Field] = []
    entry_indent: int | None = None

    def finish_current() -> None:
        nonlocal current_name, current_indent, current_fields
        if current_name is None:
            return
        images.append(_Image(current_name, tuple(current_fields)))
        current_name = None
        current_indent = None
        current_fields = []

    for index in range(start, end):
        line = lines[index]
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue

        entry_match = ENTRY_PATTERN.fullmatch(line)
        if entry_match:
            finish_current()
            current_indent = len(entry_match.group("indent"))
            if entry_indent is None:
                entry_indent = current_indent
            elif current_indent != entry_indent:
                raise _fail(f"inconsistent image entry indentation on line {index + 1}")
            current_name = entry_match.group("value")
            if IMAGE_NAME_PATTERN.fullmatch(current_name) is None:
                raise _fail(f"invalid plain image name on line {index + 1}")
            continue

        field_match = FIELD_PATTERN.fullmatch(line)
        if field_match is None or current_name is None or current_indent is None:
            raise _fail(f"unsupported or ambiguous images syntax on line {index + 1}")
        if len(field_match.group("indent")) != current_indent + 2:
            raise _fail(f"invalid image field indentation on line {index + 1}")
        key = field_match.group("key")
        if key not in ALLOWED_FIELDS:
            raise _fail(f"unsupported image field {key!r} on line {index + 1}")
        if any(field.key == key for field in current_fields):
            raise _fail(f"duplicate image field {key!r} on line {index + 1}")
        current_fields.append(_Field(key, field_match.group("value"), index))

    finish_current()
    if not images:
        raise _fail("images block contains no image entries")
    if len({image.name for image in images}) != len(images):
        raise _fail("images block contains duplicate image names")
    return images


def _render_updated(content: bytes, image_name: str, digest: str) -> bytes:
    if IMAGE_NAME_PATTERN.fullmatch(image_name) is None:
        raise _fail("image name must be a plain lowercase Kustomize image name")
    if DIGEST_PATTERN.fullmatch(digest) is None:
        raise _fail("digest must match lowercase sha256 followed by 64 hex characters")

    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError as error:
        raise _fail("manifest must be UTF-8") from error
    lines = text.splitlines(keepends=True)
    images = _parse_images(lines)
    matches = [image for image in images if image.name == image_name]
    if len(matches) != 1:
        raise _fail(f"image {image_name!r} must occur exactly once")

    image = matches[0]
    if any(field.key == "newTag" for field in image.fields):
        raise _fail(f"image {image_name!r} must not contain newTag")
    digest_fields = [field for field in image.fields if field.key == "digest"]
    if len(digest_fields) != 1:
        raise _fail(f"image {image_name!r} must contain exactly one digest field")

    target = digest_fields[0]
    if re.fullmatch(r"sha256:[0-9A-Za-z]+", target.value) is None:
        raise _fail("existing digest must be an unquoted sha256 scalar")
    digest_line_pattern = re.compile(
        r"^(?P<prefix> +digest: +)(?P<value>[^ #\t\r\n]+)(?P<suffix>(?: +#.*)?(?:\r?\n)?)$"
    )
    match = digest_line_pattern.fullmatch(lines[target.line_index])
    if match is None:
        raise _fail("digest field is not a replaceable plain scalar")
    lines[target.line_index] = (
        match.group("prefix") + digest + match.group("suffix")
    )
    return "".join(lines).encode("utf-8")


def _atomic_write(path: Path, content: bytes, mode: int) -> None:
    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as temporary:
            temporary_path = Path(temporary.name)
            temporary.write(content)
            temporary.flush()
            os.fsync(temporary.fileno())
        os.chmod(temporary_path, stat.S_IMODE(mode))
        os.replace(temporary_path, path)
        temporary_path = None
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


def update_digest(path: Path, image_name: str, digest: str) -> bool:
    """Replace one digest atomically; return whether file bytes changed."""

    manifest = Path(path)
    try:
        before = manifest.read_bytes()
        mode = manifest.stat().st_mode
    except OSError as error:
        raise _fail(f"cannot read manifest {manifest}: {error}") from error
    after = _render_updated(before, image_name, digest)
    if after == before:
        return False
    try:
        _atomic_write(manifest, after, mode)
    except OSError as error:
        raise _fail(f"cannot atomically replace manifest {manifest}: {error}") from error
    return True


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--file", required=True, type=Path)
    parser.add_argument("image_name")
    parser.add_argument("digest")
    return parser


def main(argv: list[str] | None = None) -> int:
    arguments = build_parser().parse_args(argv)
    try:
        changed = update_digest(
            arguments.file,
            arguments.image_name,
            arguments.digest,
        )
    except DigestUpdateError as error:
        print(f"digest update rejected: {error}", file=sys.stderr)
        return 2
    print("updated" if changed else "unchanged")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
