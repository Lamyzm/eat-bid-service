"""모듈 책임: 정부 공개 코드 파일 source의 검토된 요청·payload 계약과 그 지문의 단일 권위를 갖고,
받은 바이트가 그 계약을 지키는지 판정한다.

audit fixture(`docs/audit-source/reference-source-contracts.json`)가 아니라 이 모듈이 실행 시점의
권위인 이유는 dataplane 이미지에 `docs/`가 들어가지 않기 때문이다. 둘이 어긋나면
`tests/unit/test_reference_source_contracts.py`가 막으므로 관측 기록과 실행 계약은 한 쌍으로 움직인다.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from hashlib import sha256
from types import MappingProxyType

from eatbid.errors import SourceContractError

# 이 저장소의 source id다. `ingest.source_release.source`는 소문자 kebab-case slug만 받는다.
MOIS_STANDARD_CODE = "mois-standard-code"
LEGAL_DONG_DATASET = "legal-dong"
LEGAL_DONG_CHANGE_DATASET = "legal-dong-change"

# 행정안전부 행정구역 code scheme namespace의 Python 단일 선언이다. 짝이 되는 선언은 시드
# `packages/db/src/seeds/code-schemes.ts` 하나뿐이며, 파서·투영·매핑은 전부 이 이름을 참조만 한다
# (PDR-0001 "선언은 한 곳이고 나머지는 전부 참조").
MOIS_ADMINISTRATIVE_REGION_SCHEME = "mois:administrative-region"


@dataclass(frozen=True, slots=True)
class ReferenceRequestContract:
    """공식 파일 하나를 받아 오는 요청의 검토된 모양이다. 인증·세션 파라미터는 담지 않는다."""

    method: str
    url: str
    referer: str
    form: Mapping[str, str]


@dataclass(frozen=True, slots=True)
class ReferencePayloadContract:
    """압축을 푼 본문 한 장의 검토된 모양이다.

    `columns`가 tuple인 이유는 순서가 계약의 일부이기 때문이다. 정부 파일에는 컬럼 이름이 헤더 한
    줄로만 오고 위치로 읽히므로, 순서가 바뀌면 같은 이름이라도 다른 파일이다.
    """

    encoding: str
    delimiter: str
    line_terminator: str
    columns: tuple[str, ...]
    code_column: str
    label_column: str
    state_column: str
    code_length: int
    active_state: str
    retired_state: str


@dataclass(frozen=True, slots=True)
class ReferenceDatasetContract:
    dataset: str
    availability: str
    required: bool
    # 이 dataset이 채우는 code scheme이다. 파서가 scheme 이름을 따로 적으면 "이 파일이 어느 체계를
    # 만드는가"가 두 곳에 살고 그 둘이 어긋나도 아무도 모른다.
    scheme: str | None
    request: ReferenceRequestContract | None
    payload: ReferencePayloadContract | None

    @property
    def is_observed(self) -> bool:
        return self.availability == "observed"


@dataclass(frozen=True, slots=True)
class ReferenceSourceContract:
    source_id: str
    owner: str
    origin: str
    datasets: Mapping[str, ReferenceDatasetContract]

    @property
    def schema_fingerprint(self) -> str:
        """관측된 dataset의 컬럼 모양 하나만으로 지문을 만든다.

        eaT 계약(`source/eat/schema_contract.py`)과 같은 정규화(정렬된 컬럼 집합의 canonical JSON)를
        쓴다. 두 source의 지문을 같은 방식으로 읽어야 "소스가 모양을 바꿨다"가 한 가지 뜻이 된다.
        """
        shape = {
            dataset.dataset: sorted(dataset.payload.columns)
            for dataset in self.datasets.values()
            if dataset.payload is not None
        }
        canonical = json.dumps(
            shape, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        ).encode("utf-8")
        return sha256(canonical).hexdigest()


_MOIS_LEGAL_DONG = ReferenceDatasetContract(
    dataset=LEGAL_DONG_DATASET,
    availability="observed",
    required=True,
    scheme=MOIS_ADMINISTRATIVE_REGION_SCHEME,
    request=ReferenceRequestContract(
        method="POST",
        url="https://www.code.go.kr/etc/codeFullDown.do",
        referer="https://www.code.go.kr/stdcode/regCodeL.do",
        form=MappingProxyType({"codeseId": "법정동코드"}),
    ),
    payload=ReferencePayloadContract(
        encoding="cp949",
        delimiter="\t",
        line_terminator="\r\n",
        columns=("법정동코드", "법정동명", "폐지여부"),
        code_column="법정동코드",
        label_column="법정동명",
        state_column="폐지여부",
        code_length=10,
        active_state="존재",
        retired_state="폐지",
    ),
)

# 2026-09-06 관측에서 이 화면이 주는 다운로드는 사용자 검색자료와 전체자료 둘뿐이고 변동내역 파일은
# 없다. 없다는 사실을 계약에 남겨야 `valid_from`·`valid_to`가 null인 이유가 코드에서 읽힌다(ADR 0035).
_MOIS_LEGAL_DONG_CHANGE = ReferenceDatasetContract(
    dataset=LEGAL_DONG_CHANGE_DATASET,
    availability="absent",
    required=False,
    scheme=MOIS_ADMINISTRATIVE_REGION_SCHEME,
    request=None,
    payload=None,
)

REVIEWED_REFERENCE_CONTRACTS: Mapping[str, ReferenceSourceContract] = MappingProxyType(
    {
        MOIS_STANDARD_CODE: ReferenceSourceContract(
            source_id=MOIS_STANDARD_CODE,
            owner="행정안전부 행정표준코드관리시스템",
            origin="https://www.code.go.kr",
            datasets=MappingProxyType(
                {
                    LEGAL_DONG_DATASET: _MOIS_LEGAL_DONG,
                    LEGAL_DONG_CHANGE_DATASET: _MOIS_LEGAL_DONG_CHANGE,
                }
            ),
        )
    }
)


def reference_source_contract(source_id: str) -> ReferenceSourceContract:
    contract = REVIEWED_REFERENCE_CONTRACTS.get(source_id)
    if contract is None:
        raise SourceContractError(f"reviewed reference source is missing: {source_id}")
    return contract


def reference_dataset_contract(
    source_id: str, dataset: str
) -> ReferenceDatasetContract:
    """검토되고 **관측된** dataset만 돌려준다.

    관측된 적 없는 dataset을 요청하면 계약 위반이다. 없는 파일을 빈 결과로 넘기면 유효기간이 비어
    있는 이유가 "소스가 주지 않았다"인지 "우리가 안 읽었다"인지 구분되지 않는다(AGENTS 3).
    """
    contract = reference_source_contract(source_id)
    dataset_contract = contract.datasets.get(dataset)
    if dataset_contract is None:
        raise SourceContractError(
            f"reviewed reference dataset is missing: {source_id}/{dataset}"
        )
    if not dataset_contract.is_observed:
        raise SourceContractError(
            f"reference dataset is not published by the source: {source_id}/{dataset}"
        )
    return dataset_contract


def decode_reference_payload(
    body: bytes, *, contract: ReferenceDatasetContract
) -> Sequence[Sequence[str]]:
    """검토된 인코딩·구분자·헤더 계약대로 본문을 표로 읽는다. 어긋나면 전부 계약 위반이다.

    헤더를 매번 대조하는 이유는 정부 파일이 컬럼을 위치로만 주기 때문이다. 이름이 하나만 바뀌어도
    아래 파서가 엉뚱한 자리를 코드로 읽게 되고, 그 오염은 release가 봉인된 뒤에 드러난다.
    """
    payload = contract.payload
    if payload is None:
        raise SourceContractError(
            f"reference dataset has no reviewed payload: {contract.dataset}"
        )
    try:
        text = body.decode(payload.encoding)
    except UnicodeDecodeError as error:
        raise SourceContractError(
            f"reference payload is not {payload.encoding}: {contract.dataset}"
        ) from error
    lines = [line for line in text.replace("\r\n", "\n").split("\n") if line.strip()]
    if not lines:
        raise SourceContractError(f"reference payload is empty: {contract.dataset}")
    header = tuple(cell.strip() for cell in lines[0].split(payload.delimiter))
    if header != payload.columns:
        raise SourceContractError(
            f"reference payload columns changed: {contract.dataset}"
        )
    rows: list[tuple[str, ...]] = []
    for line in lines[1:]:
        cells = tuple(line.split(payload.delimiter))
        if len(cells) != len(payload.columns):
            raise SourceContractError(
                f"reference payload row width changed: {contract.dataset}"
            )
        rows.append(cells)
    return rows
