"""모듈 책임: Nexacro 응답 bytes를 안전하게 dataset과 column으로 풀고 그 모양의 fingerprint를
계산한다. 소스가 규격을 어긴 payload를 보낼 때의 좁은 복구도 여기가 소유한다."""

from __future__ import annotations

import json
import re
from collections.abc import Iterable, Mapping
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


@dataclass(frozen=True, slots=True)
class ParsedNexacro:
    datasets: Mapping[str, tuple[Mapping[str, str], ...]]
    schema_fingerprint: str


# XML에서 `&`는 참조의 시작이므로 문자 자체를 보내려면 `&amp;`여야 한다. 이 패턴은 뒤에 유효한
# 참조가 오지 않는 `&`만 고른다.
_BARE_AMPERSAND = re.compile(
    rb"&(?!(?:[A-Za-z][A-Za-z0-9._-]*|#[0-9]+|#[xX][0-9A-Fa-f]+);)"
)


def _escape_bare_ampersands(payload: bytes) -> bytes:
    """왜 원본을 고쳐서 파싱하나.

    2026-09-03 실측에서 eaT가 이스케이프하지 않은 `&`를 그대로 보냈다. 납품장소가
    "협성고등학교&협성경복중학교 공동 급식실"인 공고 하나 때문에 1000건짜리 페이지 전체가 well-formed
    하지 않게 되고 그 달 수집이 통째로 실패했다. 1년치 규모에서는 반드시 반복된다.

    R2에 보존되는 원본은 바이트 그대로이며 이 복구는 해석 단계에만 적용한다. 관측과 해석을 나눈
    규칙 3이 이런 소스 결함을 흡수하라고 둔 경계다. 유효한 참조 뒤의 `&`는 건드리지 않으므로 정상
    payload는 바이트가 바뀌지 않고, `&`를 리터럴로 만드는 방향이라 entity 위험도 늘지 않는다.
    """
    return _BARE_AMPERSAND.sub(b"&amp;", payload)


# `<Col id="...">본문</Col>`의 본문만 고른다. 닫는 태그까지 non-greedy라 첫 `</Col>`에서 끊기고,
# Col 경계 밖(Dataset·Row·ColumnInfo 구조)은 이 패턴에 걸리지 않는다.
_COL_BODY = re.compile(rb"(<Col(?=[\s>])[^>]*>)(.*?)(</Col>)", re.DOTALL)


def _escape_bare_angle_brackets(payload: bytes) -> bytes:
    """왜 Col 본문의 `<`만 리터럴로 바꾸나.

    2026-09-17 실측에서 기관이 기타 유의사항 칸에 `<연락처>`라고 꺾쇠를 그대로 입력했고 eaT가 그것을
    이스케이프하지 않은 채 본문에 실어 보냈다. XML 파서는 그것을 여는 태그로 읽고 닫는 태그가 없어
    payload 전체를 거부한다. 격리 하나가 회차 전체를 `DATA_QUARANTINED`로 만들므로 공고 하나의 오타가
    그 회차의 모든 공고를 화면에서 지운다(EAT-268).

    `&` 복구(위)와 같은 경계다. 원본 바이트는 R2에 그대로 남고 이 복구는 해석 단계에만 적용하며,
    치환 방향이 태그를 리터럴로 만드는 쪽이라 구조 공격 표면이 늘지 않는다. Col 경계 밖은 건드리지
    않으므로 Dataset·Row 구조가 깨진 payload는 그대로 거부된다.
    """

    def _literalize(match: re.Match[bytes]) -> bytes:
        return match.group(1) + match.group(2).replace(b"<", b"&lt;") + match.group(3)

    return _COL_BODY.sub(_literalize, payload)


def parse_nexacro(payload: bytes, *, require_ds_info: bool = False) -> ParsedNexacro:
    if not isinstance(payload, bytes):
        raise TypeError("Nexacro payload must be bytes")
    try:
        root = ElementTree.fromstring(
            _escape_bare_angle_brackets(_escape_bare_ampersands(payload)),
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
    fingerprint = schema_fingerprint(schema)
    if require_ds_info and len(datasets.get("ds_info", ())) != 1:
        raise NexacroParseError(
            "ds_info must contain exactly one row",
            schema_fingerprint=fingerprint,
        )
    return ParsedNexacro(
        datasets=MappingProxyType(datasets),
        schema_fingerprint=fingerprint,
    )


def schema_fingerprint(schema: Mapping[str, Iterable[str]]) -> str:
    canonical_shape = {
        dataset_id: sorted(set(column_ids)) for dataset_id, column_ids in schema.items()
    }
    canonical = json.dumps(
        canonical_shape, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return sha256(canonical).hexdigest()
