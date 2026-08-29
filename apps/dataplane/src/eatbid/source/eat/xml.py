from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass
from hashlib import sha256
from types import MappingProxyType
from xml.etree.ElementTree import ParseError

from defusedxml import ElementTree
from defusedxml.common import DefusedXmlException
from pydantic import StrictStr, TypeAdapter, ValidationError

NEXACRO_DATASET_NAMESPACE = "http://www.nexacroplatform.com/platform/dataset"
_ROW_ADAPTER = TypeAdapter(dict[str, StrictStr])


class EatPayloadError(ValueError):
    """Known malformed or contract-invalid eaT source input."""


class NexacroParseError(EatPayloadError):
    def __init__(self, message: str, *, schema_fingerprint: str | None = None) -> None:
        super().__init__(message)
        self.schema_fingerprint = schema_fingerprint


class SourceContractError(EatPayloadError):
    """A source-level invariant needed for run completeness was violated."""


@dataclass(frozen=True, slots=True)
class ParsedNexacro:
    datasets: Mapping[str, tuple[Mapping[str, str], ...]]
    schema_fingerprint: str


def parse_nexacro(payload: bytes, *, require_ds_info: bool = False) -> ParsedNexacro:
    if not isinstance(payload, bytes):
        raise TypeError("Nexacro payload must be bytes")
    try:
        root = ElementTree.fromstring(
            payload,
            forbid_dtd=True,
            forbid_entities=True,
            forbid_external=True,
        )
    except (DefusedXmlException, ParseError, ValueError) as error:
        raise NexacroParseError(f"unsafe or malformed Nexacro XML: {error}") from error

    namespace_prefix = f"{{{NEXACRO_DATASET_NAMESPACE}}}"
    if root.tag != f"{namespace_prefix}Root":
        raise NexacroParseError("Nexacro Root namespace is required")

    datasets: dict[str, tuple[Mapping[str, str], ...]] = {}
    schema: dict[str, list[str]] = {}
    for dataset in root.findall(f".//{namespace_prefix}Dataset"):
        dataset_id = dataset.get("id")
        if not dataset_id:
            raise NexacroParseError("Dataset id is required")
        if dataset_id in datasets:
            raise NexacroParseError(f"duplicate Dataset id: {dataset_id}")

        declared_columns: list[str] = []
        column_info_nodes = dataset.findall(f"{namespace_prefix}ColumnInfo")
        if len(column_info_nodes) > 1:
            raise NexacroParseError(f"duplicate ColumnInfo in Dataset {dataset_id}")
        if column_info_nodes:
            for column in column_info_nodes[0].findall(f"{namespace_prefix}Column"):
                column_id = column.get("id")
                if not column_id:
                    raise NexacroParseError(
                        f"ColumnInfo column id is required in Dataset {dataset_id}"
                    )
                if column_id in declared_columns:
                    raise NexacroParseError(
                        f"duplicate column id {column_id} in Dataset {dataset_id}"
                    )
                declared_columns.append(column_id)

        rows_nodes = dataset.findall(f"{namespace_prefix}Rows")
        if len(rows_nodes) > 1:
            raise NexacroParseError(f"duplicate Rows in Dataset {dataset_id}")
        row_elements = (
            rows_nodes[0].findall(f"{namespace_prefix}Row") if rows_nodes else []
        )
        rows: list[Mapping[str, str]] = []
        observed_columns: set[str] = set()
        for row_element in row_elements:
            raw_row: dict[str, str] = {}
            for column in row_element.findall(f"{namespace_prefix}Col"):
                column_id = column.get("id")
                if not column_id:
                    raise NexacroParseError(
                        f"row column id is required in Dataset {dataset_id}"
                    )
                if column_id in raw_row:
                    raise NexacroParseError(
                        f"duplicate column id {column_id} in Dataset {dataset_id}"
                    )
                if declared_columns and column_id not in declared_columns:
                    raise NexacroParseError(
                        f"undeclared column id {column_id} in Dataset {dataset_id}"
                    )
                raw_row[column_id] = column.text or ""
                observed_columns.add(column_id)
            try:
                typed_row = _ROW_ADAPTER.validate_python(raw_row, strict=True)
            except ValidationError as error:  # defensive boundary for future fragments
                raise NexacroParseError(
                    f"invalid row fragment in Dataset {dataset_id}"
                ) from error
            rows.append(MappingProxyType(typed_row))

        datasets[dataset_id] = tuple(rows)
        schema[dataset_id] = sorted(set(declared_columns) | observed_columns)

    if not datasets:
        raise NexacroParseError("at least one Nexacro Dataset is required")
    fingerprint = _schema_fingerprint(schema)
    if require_ds_info and len(datasets.get("ds_info", ())) != 1:
        raise NexacroParseError(
            "ds_info must contain exactly one row",
            schema_fingerprint=fingerprint,
        )
    return ParsedNexacro(
        datasets=MappingProxyType(datasets),
        schema_fingerprint=fingerprint,
    )


def _schema_fingerprint(schema: Mapping[str, list[str]]) -> str:
    canonical = json.dumps(
        dict(schema), ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return sha256(canonical).hexdigest()
