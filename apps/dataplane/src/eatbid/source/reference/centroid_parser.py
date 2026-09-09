"""모듈 책임: 시군구 중심좌표 소스 파일의 행을 CRS가 붙은 좌표 관측값으로 옮긴다.

법정동코드 파서와 별개 모듈인 이유는 좌표가 코드의 속성이 아니라 **별개 release의 관측**이기
때문이다(ADR 0035 결정 5). 좌표 소스를 교체해도 코드 파서가 그대로 남는다.
"""

from __future__ import annotations

import csv
from collections.abc import Sequence
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from io import StringIO

from eatbid.code_labels import normalize_code_label
from eatbid.failures.errors import SourceContractError

# 좌표계는 파일이 아니라 계약이 말한다. 파일이 좌표계를 적어 주지 않으므로 우리가 어느 계로 읽는지를
# 계약에 남기고, 다른 계의 파일을 받으면 값 범위 검사에서 걸리게 한다.
CENTROID_CRS = "EPSG:4326"
CENTROID_COLUMNS: tuple[str, ...] = ("path", "latitude", "longitude")


@dataclass(frozen=True, slots=True)
class ObservedCentroid:
    """이름 경로 하나에 붙은 좌표 관측이다. 코드가 아니라 이름으로 오는 것이 이 소스의 성질이다."""

    path: tuple[str, ...]
    latitude: Decimal
    longitude: Decimal


def parse_centroid_rows(payload: bytes, *, encoding: str = "utf-8") -> tuple[ObservedCentroid, ...]:
    """좌표 파일을 계약된 컬럼으로 읽는다. 값이 지구 밖이면 좌표계가 다른 파일이므로 거부한다."""
    try:
        text = payload.decode(encoding)
    except UnicodeDecodeError as error:
        raise SourceContractError("centroid payload is not utf-8") from error
    reader = csv.reader(StringIO(text))
    rows = [row for row in reader if any(cell.strip() for cell in row)]
    if not rows:
        raise SourceContractError("centroid payload is empty")
    header = tuple(cell.strip() for cell in rows[0])
    if header != CENTROID_COLUMNS:
        raise SourceContractError("centroid payload columns changed")
    observed = [_row(row) for row in rows[1:]]
    _require_unique_paths(observed)
    return tuple(observed)


def _row(row: Sequence[str]) -> ObservedCentroid:
    if len(row) != len(CENTROID_COLUMNS):
        raise SourceContractError("centroid payload row width changed")
    path = tuple(
        normalize_code_label(segment)
        for segment in row[0].split("/")
        if normalize_code_label(segment)
    )
    if not path:
        raise SourceContractError("centroid row has no name path")
    try:
        # 좌표는 exact decimal로 읽는다. float로 받으면 저장 직전에 이미 값이 달라진다(AGENTS 15).
        latitude = Decimal(row[1].strip())
        longitude = Decimal(row[2].strip())
    except InvalidOperation as error:
        raise SourceContractError("centroid coordinate is not a decimal") from error
    if not (-90 <= latitude <= 90) or not (-180 <= longitude <= 180):
        raise SourceContractError("centroid coordinate is outside WGS84 bounds")
    return ObservedCentroid(path=path, latitude=latitude, longitude=longitude)


def _require_unique_paths(observed: Sequence[ObservedCentroid]) -> None:
    """같은 이름 경로에 좌표가 둘이면 어느 점이 사실인지 우리가 고르게 되므로 거부한다."""
    paths = [item.path for item in observed]
    if len(set(paths)) != len(paths):
        raise SourceContractError("centroid payload has duplicate name paths")
