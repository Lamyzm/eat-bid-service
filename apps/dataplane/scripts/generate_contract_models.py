"""모듈 책임: `packages/contracts/generated`의 계약별 JSON Schema를 입력으로 삼아
`datamodel-codegen`을 계약 쌍마다 돌리고, 각 쌍의 drift를 독립적으로 판정한다. 한 계약의
drift가 다른 계약의 생성물을 덮어쓰지 않도록 --write/--check 모두 (스키마, 생성물) 쌍 단위로
격리한다.
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
DATAPLANE_ROOT = REPOSITORY_ROOT / "apps" / "dataplane"
SCHEMA_ROOT = REPOSITORY_ROOT / "packages" / "contracts" / "generated"
GENERATED_ROOT = DATAPLANE_ROOT / "src" / "eatbid" / "generated"

# 계약마다 독립된 (스키마, 생성물) 쌍이다. 한 쌍의 drift는 다른 쌍의 생성물을 건드리지 않는다.
CONTRACTS: tuple[tuple[Path, Path], ...] = (
    (SCHEMA_ROOT / "ingestion-v1.schema.json", GENERATED_ROOT / "ingestion_v1.py"),
    (SCHEMA_ROOT / "ingestion-v2.schema.json", GENERATED_ROOT / "ingestion_v2.py"),
    (SCHEMA_ROOT / "code-release-v1.schema.json", GENERATED_ROOT / "code_release_v1.py"),
    (
        SCHEMA_ROOT / "code-vocabulary-v1.schema.json",
        GENERATED_ROOT / "code_vocabulary_v1.py",
    ),
)


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


def _generate_to(schema_path: Path, output_path: Path) -> None:
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
            str(schema_path),
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
            str(output_path),
        ],
        cwd=REPOSITORY_ROOT,
        check=True,
    )


def _sync_one(schema_path: Path, output_path: Path, *, check: bool) -> bool:
    """한 계약 쌍을 생성기에 돌리고, check 모드면 drift 여부만 판정한다.

    write 모드에서는 항상 True를 반환한다(예외는 subprocess 실패로 전파된다).
    check 모드에서는 커밋된 생성물과 정규화된 바이트가 같을 때만 True다.
    """
    output_path.parent.mkdir(parents=True, exist_ok=True)

    temporary_handle, temporary_name = tempfile.mkstemp(
        dir=output_path.parent,
        prefix=f".{output_path.stem}.",
        suffix=".py",
    )
    os.close(temporary_handle)
    temporary_path = Path(temporary_name)

    try:
        _generate_to(schema_path, temporary_path)
        generated = _normalized_generated_bytes(temporary_path)

        if check:
            if not output_path.exists() or _normalized_generated_bytes(output_path) != generated:
                print(f"Generated contract model drift detected: {output_path}")
                return False
            return True

        temporary_path.write_bytes(generated)
        os.replace(temporary_path, output_path)
        return True
    finally:
        temporary_path.unlink(missing_ok=True)


def main() -> int:
    arguments = _arguments()

    # 한 쌍의 drift가 다른 쌍의 검사를 가리지 않도록 전부 돌리고 나서 판정한다.
    all_ok = True
    for schema_path, output_path in CONTRACTS:
        if not _sync_one(schema_path, output_path, check=arguments.check):
            all_ok = False

    return 0 if all_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
