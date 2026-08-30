from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
DATAPLANE_ROOT = REPOSITORY_ROOT / "apps" / "dataplane"
SCHEMA_PATH = (
    REPOSITORY_ROOT
    / "packages"
    / "contracts"
    / "generated"
    / "ingestion-v1.schema.json"
)
OUTPUT_PATH = DATAPLANE_ROOT / "src" / "eatbid" / "generated" / "ingestion_v1.py"


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate deterministic Pydantic models from portable contracts."
    )
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--write", action="store_true", help="Replace generated output.")
    mode.add_argument("--check", action="store_true", help="Fail when output has drifted.")
    return parser.parse_args()


def _normalized_generated_bytes(path: Path) -> bytes:
    text = path.read_text(encoding="utf-8")
    return text.replace("\r\n", "\n").replace("\r", "\n").encode("utf-8")


def _generate_to(path: Path) -> None:
    uv = shutil.which("uv")
    if uv is None:
        raise RuntimeError("uv executable was not found on PATH")

    subprocess.run(
        [
            uv,
            "run",
            "--project",
            str(DATAPLANE_ROOT),
            "datamodel-codegen",
            "--input",
            str(SCHEMA_PATH),
            "--input-file-type",
            "jsonschema",
            "--output-model-type",
            "pydantic_v2.BaseModel",
            "--preset",
            "practical-py312-20260619",
            "--snake-case-field",
            "--disable-timestamp",
            "--formatters",
            "builtin",
            "--output",
            str(path),
        ],
        cwd=REPOSITORY_ROOT,
        check=True,
    )


def main() -> int:
    arguments = _arguments()
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)

    temporary_handle, temporary_name = tempfile.mkstemp(
        dir=OUTPUT_PATH.parent,
        prefix=f".{OUTPUT_PATH.stem}.",
        suffix=".py",
    )
    os.close(temporary_handle)
    temporary_path = Path(temporary_name)

    try:
        _generate_to(temporary_path)
        generated = _normalized_generated_bytes(temporary_path)

        if arguments.check:
            if not OUTPUT_PATH.exists() or _normalized_generated_bytes(OUTPUT_PATH) != generated:
                print(f"Generated contract model drift detected: {OUTPUT_PATH}")
                return 1
            return 0

        temporary_path.write_bytes(generated)
        os.replace(temporary_path, OUTPUT_PATH)
        return 0
    finally:
        temporary_path.unlink(missing_ok=True)


if __name__ == "__main__":
    raise SystemExit(main())
