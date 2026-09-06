from __future__ import annotations

import json
from pathlib import Path

import pytest

from eatbid.errors import SourceContractError
from eatbid.source.reference.source_contracts import (
    LEGAL_DONG_CHANGE_DATASET,
    LEGAL_DONG_DATASET,
    MOIS_STANDARD_CODE,
    REVIEWED_REFERENCE_CONTRACTS,
    decode_reference_payload,
    reference_dataset_contract,
    reference_source_contract,
)

REPOSITORY_ROOT = Path(__file__).resolve().parents[4]
AUDIT_PATH = REPOSITORY_ROOT / "docs" / "audit-source" / "reference-source-contracts.json"
SAMPLE_PATH = (
    REPOSITORY_ROOT
    / "apps"
    / "dataplane"
    / "tests"
    / "fixtures"
    / "reference"
    / "mois-legal-dong-sample.txt"
)


def _audit() -> dict[str, object]:
    return json.loads(AUDIT_PATH.read_text(encoding="utf-8"))


def _audit_source(source_id: str) -> dict[str, object]:
    sources = _audit()["sources"]
    assert isinstance(sources, list)
    return next(item for item in sources if item["source_id"] == source_id)


def _sample_bytes() -> bytes:
    return SAMPLE_PATH.read_bytes()


def test_행안부_source_계약이_dataset과_지문을_모두_고정한다() -> None:
    contract = reference_source_contract(MOIS_STANDARD_CODE)
    assert set(contract.datasets) == {LEGAL_DONG_DATASET, LEGAL_DONG_CHANGE_DATASET}
    assert contract.schema_fingerprint == _audit_source(MOIS_STANDARD_CODE)["schema_fingerprint"]


def test_audit_fixture와_실행_계약의_컬럼이_어긋나지_않는다() -> None:
    audit = _audit_source(MOIS_STANDARD_CODE)
    contract = reference_source_contract(MOIS_STANDARD_CODE)
    assert audit["owner"] == contract.owner
    assert audit["origin"] == contract.origin
    for observed in audit["datasets"]:
        dataset = contract.datasets[observed["dataset"]]
        assert dataset.availability == observed["availability"]
        assert dataset.required == observed["required"]
        if dataset.payload is None:
            assert observed.get("payload") is None
            continue
        payload = observed["payload"]
        assert list(dataset.payload.columns) == payload["columns"]
        assert dataset.payload.encoding == payload["encoding"]
        assert dataset.payload.code_length == payload["code_length"]
        assert dataset.payload.active_state == payload["active_state"]
        assert dataset.payload.retired_state == payload["retired_state"]


def test_변동내역은_소스가_주지_않는다는_사실로_남고_요청하면_계약_위반이다() -> None:
    contract = reference_source_contract(MOIS_STANDARD_CODE)
    absent = contract.datasets[LEGAL_DONG_CHANGE_DATASET]
    assert absent.availability == "absent"
    assert absent.payload is None
    with pytest.raises(SourceContractError):
        reference_dataset_contract(MOIS_STANDARD_CODE, LEGAL_DONG_CHANGE_DATASET)


def test_검토되지_않은_source나_dataset은_계약_위반이다() -> None:
    with pytest.raises(SourceContractError):
        reference_source_contract("mois-administrative-dong")
    with pytest.raises(SourceContractError):
        reference_dataset_contract(MOIS_STANDARD_CODE, "legal-dong-english")


def test_표본은_계약된_CP949_탭_구분으로만_읽힌다() -> None:
    dataset = reference_dataset_contract(MOIS_STANDARD_CODE, LEGAL_DONG_DATASET)
    rows = decode_reference_payload(_sample_bytes(), contract=dataset)
    assert len(rows) == 14
    assert rows[0] == ("1100000000", "서울특별시", "존재")
    # 원본이 이름 뒤에 공백을 달고 오는 행이 실제로 있다. 표본이 그 모양을 그대로 들고 있어야
    # 정규화가 파서 안에 있는지 표본 안에 있는지가 흐려지지 않는다.
    assert any(row[1] != row[1].strip() for row in rows)


def test_인코딩이_바뀌면_계약_위반이다() -> None:
    dataset = reference_dataset_contract(MOIS_STANDARD_CODE, LEGAL_DONG_DATASET)
    utf8_body = _sample_bytes().decode("cp949").encode("utf-8")
    with pytest.raises(SourceContractError):
        decode_reference_payload(utf8_body, contract=dataset)


def test_컬럼이_더해지거나_빠지면_계약_위반이다() -> None:
    dataset = reference_dataset_contract(MOIS_STANDARD_CODE, LEGAL_DONG_DATASET)
    text = _sample_bytes().decode("cp949")
    added = text.replace("폐지여부", "폐지여부\t비고", 1)
    with pytest.raises(SourceContractError):
        decode_reference_payload(added.encode("cp949"), contract=dataset)
    removed = text.replace("법정동코드\t법정동명\t폐지여부", "법정동코드\t법정동명", 1)
    with pytest.raises(SourceContractError):
        decode_reference_payload(removed.encode("cp949"), contract=dataset)


def test_헤더와_행의_너비가_어긋나면_계약_위반이다() -> None:
    dataset = reference_dataset_contract(MOIS_STANDARD_CODE, LEGAL_DONG_DATASET)
    text = _sample_bytes().decode("cp949")
    broken = text.replace("1100000000\t서울특별시\t존재", "1100000000\t서울특별시", 1)
    with pytest.raises(SourceContractError):
        decode_reference_payload(broken.encode("cp949"), contract=dataset)


def test_빈_본문은_계약_위반이다() -> None:
    dataset = reference_dataset_contract(MOIS_STANDARD_CODE, LEGAL_DONG_DATASET)
    with pytest.raises(SourceContractError):
        decode_reference_payload(b"", contract=dataset)


def test_audit_fixture에_인증_파라미터가_남지_않는다() -> None:
    text = AUDIT_PATH.read_text(encoding="utf-8").lower()
    for secret_word in ("cookie", "jsessionid", "authorization", "servicekey", "api_key", "apikey"):
        assert secret_word not in text


def test_등록된_reference_source는_행안부_하나다() -> None:
    assert set(REVIEWED_REFERENCE_CONTRACTS) == {MOIS_STANDARD_CODE}
