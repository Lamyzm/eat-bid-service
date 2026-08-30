from __future__ import annotations

import argparse
import runpy
from collections.abc import Callable
from pathlib import Path


def test_Python_contract_check가_Windows_CRLF를_drift로_오인하지_않는다(
    tmp_path: Path,
) -> None:
    script = Path(__file__).parents[2] / "scripts" / "generate_contract_models.py"
    namespace = runpy.run_path(str(script))
    main = namespace["main"]
    assert isinstance(main, Callable)

    committed = tmp_path / "ingestion_v1.py"
    committed.write_bytes(b"class Model:\r\n    pass\r\n")
    main.__globals__["OUTPUT_PATH"] = committed
    main.__globals__["_arguments"] = lambda: argparse.Namespace(write=False, check=True)
    main.__globals__["_generate_to"] = lambda path: path.write_bytes(
        b"class Model:\n    pass\n"
    )

    assert main() == 0
    assert committed.read_bytes() == b"class Model:\r\n    pass\r\n"
