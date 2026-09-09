from __future__ import annotations

from decimal import Decimal
from pathlib import Path

import pytest

from eatbid.failures.errors import SourceContractError
from eatbid.source.reference.centroid_parser import CENTROID_CRS, parse_centroid_rows

SAMPLE_PATH = Path(__file__).parents[1] / "fixtures" / "reference" / "sgg-centroid-sample.csv"


def _rows():
    return parse_centroid_rows(SAMPLE_PATH.read_bytes())


def test_좌표는_이름_경로와_exact_decimal로_읽힌다() -> None:
    rows = _rows()
    assert rows[1].path == ("서울특별시", "종로구")
    assert rows[1].latitude == Decimal("37.573000")
    assert rows[1].longitude == Decimal("126.979000")


def test_좌표계는_파일이_아니라_계약이_말한다() -> None:
    assert CENTROID_CRS == "EPSG:4326"


def test_조립한_문자열_키가_아니라_토막의_경로로_읽는다() -> None:
    assert _rows()[2].path == ("경기도", "수원시", "장안구")


def test_컬럼이_바뀌면_계약_위반이다() -> None:
    with pytest.raises(SourceContractError):
        parse_centroid_rows("name,lat,lon\n서울특별시,1,2\n".encode())


def test_지구_밖_좌표는_다른_좌표계이므로_거부한다() -> None:
    # EPSG:5179 같은 투영 좌표는 미터 단위라 위경도 범위를 즉시 벗어난다.
    with pytest.raises(SourceContractError):
        parse_centroid_rows("path,latitude,longitude\n서울특별시,953000,1953000\n".encode())


def test_숫자가_아닌_좌표는_계약_위반이다() -> None:
    with pytest.raises(SourceContractError):
        parse_centroid_rows("path,latitude,longitude\n서울특별시,없음,126.9\n".encode())


def test_같은_이름_경로에_좌표가_둘이면_고르지_않는다() -> None:
    payload = "path,latitude,longitude\n서울특별시,37.5,126.9\n서울특별시,37.6,127.0\n".encode()
    with pytest.raises(SourceContractError):
        parse_centroid_rows(payload)


def test_빈_본문과_이름_없는_행은_계약_위반이다() -> None:
    with pytest.raises(SourceContractError):
        parse_centroid_rows(b"")
    with pytest.raises(SourceContractError):
        parse_centroid_rows(b"path,latitude,longitude\n,37.5,126.9\n")
