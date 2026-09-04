from __future__ import annotations

import argparse
import runpy
from collections.abc import Callable
from pathlib import Path

import pytest
from pydantic import ValidationError


def test_Python_contract_check가_Windows_CRLF를_drift로_오인하지_않는다(
    tmp_path: Path,
) -> None:
    script = Path(__file__).parents[2] / "scripts" / "generate_contract_models.py"
    namespace = runpy.run_path(str(script))
    main = namespace["main"]
    assert isinstance(main, Callable)

    committed = tmp_path / "ingestion_v1.py"
    committed.write_bytes(b"class Model:\r\n    pass\r\n")
    fake_schema = tmp_path / "ingestion-v1.schema.json"
    main.__globals__["CONTRACTS"] = ((fake_schema, committed),)
    main.__globals__["_arguments"] = lambda: argparse.Namespace(write=False, check=True)
    main.__globals__["_generate_to"] = lambda schema_path, output_path: output_path.write_bytes(
        b"class Model:\n    pass\n"
    )

    assert main() == 0
    assert committed.read_bytes() == b"class Model:\r\n    pass\r\n"


def test_계약_쌍_중_하나만_drift해도_그_경로를_보고하고_1을_반환한다(
    tmp_path: Path,
) -> None:
    script = Path(__file__).parents[2] / "scripts" / "generate_contract_models.py"
    namespace = runpy.run_path(str(script))
    main = namespace["main"]
    assert isinstance(main, Callable)

    fresh_output = tmp_path / "ingestion_v1.py"
    fresh_output.write_bytes(b"class Fresh:\n    pass\n")
    drifted_output = tmp_path / "ingestion_v2.py"
    drifted_output.write_bytes(b"class Stale:\n    pass\n")
    main.__globals__["CONTRACTS"] = (
        (tmp_path / "ingestion-v1.schema.json", fresh_output),
        (tmp_path / "ingestion-v2.schema.json", drifted_output),
    )
    main.__globals__["_arguments"] = lambda: argparse.Namespace(write=False, check=True)

    def _fake_generate_to(schema_path: Path, output_path: Path) -> None:
        del schema_path
        output_path.write_bytes(
            b"class Fresh:\n    pass\n" if output_path == fresh_output else b"class Changed:\n    pass\n"
        )

    main.__globals__["_generate_to"] = _fake_generate_to

    assert main() == 1
    assert fresh_output.read_bytes() == b"class Fresh:\n    pass\n"
    assert drifted_output.read_bytes() == b"class Stale:\n    pass\n"


def test_계약별_생성물이_각자의_스키마에서_나온다() -> None:
    from eatbid.generated import ingestion_v1, ingestion_v2

    assert ingestion_v1.EatbidIngestionAuctionV1.model_fields.keys() == {
        "contract_version", "identity", "buyer", "location", "schedule", "pricing", "classification",
    }
    v2_fields = ingestion_v2.EatbidIngestionAuctionV2.model_fields
    assert {"terms", "roster", "award", "reserve_price_draw", "lineage"} <= v2_fields.keys()


def test_v2_명단_행은_사정률을_문자열_봉투로만_받는다() -> None:
    from eatbid.generated.ingestion_v2 import BidRate

    assert BidRate(value="90.218", unit="percentage-points").value == "90.218"
    with pytest.raises(ValidationError):
        BidRate(value="91.87", unit="percentage-points")
