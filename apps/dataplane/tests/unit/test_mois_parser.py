from __future__ import annotations

from pathlib import Path

import pytest

from eatbid.errors import SourceContractError
from eatbid.source.reference.mois_client import unwrap_reference_archive
from eatbid.source.reference.mois_parser import (
    PROMOTED_GRAINS,
    code_grain,
    member_grain,
    parse_legal_dong_release,
)
from eatbid.source.reference.source_contracts import (
    LEGAL_DONG_DATASET,
    MOIS_STANDARD_CODE,
    decode_reference_payload,
    reference_dataset_contract,
)

SAMPLE_PATH = Path(__file__).parents[1] / "fixtures" / "reference" / "mois-legal-dong-sample.txt"


def _contract():
    return reference_dataset_contract(MOIS_STANDARD_CODE, LEGAL_DONG_DATASET)


def _release():
    contract = _contract()
    rows = decode_reference_payload(SAMPLE_PATH.read_bytes(), contract=contract)
    return parse_legal_dong_release(
        rows, contract=contract, source_id=MOIS_STANDARD_CODE, source_version="2026-09-06"
    )


def _member(code: str):
    return next(member for member in _release().members if member.code == code)


def test_법정동코드는_선행_0과_10자리를_그대로_보존한다() -> None:
    assert _member("1111000000").code == "1111000000"
    assert all(len(member.code) == 10 for member in _release().members)


def test_읍면동_행은_승격되지_않고_release가_그_사실을_기록한다() -> None:
    release = _release()
    codes = {member.code for member in release.members}
    assert "1111010100" not in codes
    assert release.source_row_count == 14
    assert release.excluded_row_count == release.source_row_count - len(release.members)
    assert [grain.root for grain in release.promoted_grain] == list(PROMOTED_GRAINS)


def test_폐지된_행은_active_False로_들어오고_삭제되지_않는다() -> None:
    retired = _member("2900000000")
    assert retired.active is False
    assert _member("1100000000").active is True


def test_말소일자가_없으면_valid_to를_지어내지_않는다() -> None:
    for member in _release().members:
        assert member.valid_from is None
        assert member.valid_to is None


def test_상위는_코드_자르기가_아니라_release의_이름_경로에서_온다() -> None:
    assert _member("1111000000").parent_code is not None
    assert _member("1111000000").parent_code.root == "1100000000"
    # 자치구가 아닌 행정구의 상위는 시도가 아니라 그 시다. 코드 앞 두 자리로 잘랐다면 경기도가 된다.
    assert _member("4111100000").parent_code.root == "4111000000"


def test_이름_뒤_공백은_상위_조회에서만_정리되고_라벨은_관측대로_남는다() -> None:
    부천_원미구 = _member("4119200000")
    assert 부천_원미구.label.endswith(" ")
    assert 부천_원미구.parent_code.root == "4119000000"


def test_상위_행이_파일에_없으면_null이고_지어내지_않는다() -> None:
    # 세종특별자치시는 시군구 grain에만 있고 상위 시도 행 자체가 파일에 없다.
    assert _member("3611000000").parent_code is None
    assert _member("1100000000").parent_code is None


def test_grain은_행정안전부_자릿수_규격으로만_판정한다() -> None:
    assert code_grain("1100000000") == "sido"
    assert code_grain("1111000000") == "sigungu"
    assert code_grain("1111010100") is None
    assert member_grain(_member("1111000000")) == "sigungu"


def test_같은_코드가_두_번_오면_어느_행이_사실인지_고르지_않는다() -> None:
    contract = _contract()
    rows = list(decode_reference_payload(SAMPLE_PATH.read_bytes(), contract=contract))
    with pytest.raises(SourceContractError):
        parse_legal_dong_release(
            [*rows, rows[0]],
            contract=contract,
            source_id=MOIS_STANDARD_CODE,
            source_version="2026-09-06",
        )


def test_알_수_없는_폐지여부_값은_계약_위반이다() -> None:
    contract = _contract()
    rows = [("1100000000", "서울특별시", "통합")]
    with pytest.raises(SourceContractError):
        parse_legal_dong_release(
            rows, contract=contract, source_id=MOIS_STANDARD_CODE, source_version="2026-09-06"
        )


def test_코드_자릿수가_바뀌면_계약_위반이다() -> None:
    contract = _contract()
    with pytest.raises(SourceContractError):
        parse_legal_dong_release(
            [("11000000", "서울특별시", "존재")],
            contract=contract,
            source_id=MOIS_STANDARD_CODE,
            source_version="2026-09-06",
        )


def test_zip이_한_장이_아니면_계약_위반이다() -> None:
    import io
    import zipfile

    contract = _contract()
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as bundle:
        bundle.writestr("a.txt", "x")
        bundle.writestr("b.txt", "y")
    with pytest.raises(SourceContractError):
        unwrap_reference_archive(buffer.getvalue(), contract=contract)
    with pytest.raises(SourceContractError):
        unwrap_reference_archive(b"not a zip", contract=contract)


def test_zip_한_장은_내용_지문과_함께_돌아온다() -> None:
    import io
    import zipfile

    contract = _contract()
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as bundle:
        bundle.writestr("법정동코드 전체자료.txt", "본문")
    payload = unwrap_reference_archive(buffer.getvalue(), contract=contract)
    assert payload.body == "본문".encode()
    assert len(payload.content_sha256) == 64
