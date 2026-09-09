"""모듈 책임: 정부 공개 코드 파일을 계약대로 한 번 받아 압축을 풀고 그 바이트를 그대로 돌려준다.

행 해석은 하지 않는다. 전송 경계와 해석 경계를 나눠야 소스가 전송 방식을 바꿔도 파서가 그대로
남고, 승격 규칙을 바꿔도 이 파일이 그대로 남는다.
"""

from __future__ import annotations

import zipfile
from dataclasses import dataclass
from hashlib import sha256
from io import BytesIO
from typing import Protocol

import httpx

from eatbid.failures.errors import SourceContractError, SourceUnavailableError
from eatbid.source.reference.source_contracts import ReferenceDatasetContract

# 압축을 푼 본문을 통째로 메모리에 올린다. 실측 2.4 MiB이고 월 1회 실행이라 스트리밍이 사는 비용을
# 넘지 않는다. 상한을 두는 이유는 소스가 다른 파일을 주기 시작했을 때 조용히 삼키지 않기 위해서다.
MAX_REFERENCE_PAYLOAD_BYTES = 64 * 1024 * 1024


@dataclass(frozen=True, slots=True)
class FetchedReferencePayload:
    body: bytes
    content_sha256: str
    entry_name: str


class ReferenceHttpClient(Protocol):
    def post(
        self, url: str, *, data: dict[str, str], headers: dict[str, str]
    ) -> httpx.Response: ...


def fetch_reference_payload(
    client: ReferenceHttpClient, *, contract: ReferenceDatasetContract
) -> FetchedReferencePayload:
    """계약된 요청 하나를 보내고 zip 한 장을 푼 바이트를 돌려준다."""
    request = contract.request
    if request is None or request.method != "POST":
        raise SourceContractError(
            f"reference dataset has no reviewed request: {contract.dataset}"
        )
    try:
        response = client.post(
            request.url,
            data=dict(request.form),
            headers={"Referer": request.referer},
        )
    except httpx.HTTPError as error:
        # 응답 자체가 오지 않은 사건은 계약 위반이 아니다. 같은 exit로 묶으면 운영이 "코드를 고쳐야
        # 하는 실패"로 오독한다.
        raise SourceUnavailableError(
            f"reference source did not respond: {contract.dataset}", attempts=1
        ) from error
    if response.status_code != 200:
        raise SourceContractError(
            f"reference source returned HTTP {response.status_code}: {contract.dataset}",
            status_code=response.status_code,
        )
    body = unwrap_reference_archive(response.content, contract=contract)
    return body


def unwrap_reference_archive(
    archive: bytes, *, contract: ReferenceDatasetContract
) -> FetchedReferencePayload:
    """zip 한 장 안에 파일 하나가 있다는 계약을 검사하고 그 바이트를 돌려준다.

    "첫 항목을 쓴다"로 넘어가지 않는 이유: 항목이 둘이 되는 날 우리가 고른 하나가 규칙이 되고,
    나머지 하나가 사라진 사실을 아무도 모른다.
    """
    try:
        with zipfile.ZipFile(BytesIO(archive)) as bundle:
            entries = [item for item in bundle.infolist() if not item.is_dir()]
            if len(entries) != 1:
                raise SourceContractError(
                    f"reference archive entry count changed: {contract.dataset}"
                )
            entry = entries[0]
            if entry.file_size > MAX_REFERENCE_PAYLOAD_BYTES:
                raise SourceContractError(
                    f"reference archive entry is too large: {contract.dataset}"
                )
            body = bundle.read(entry)
    except zipfile.BadZipFile as error:
        raise SourceContractError(
            f"reference response is not a zip archive: {contract.dataset}"
        ) from error
    return FetchedReferencePayload(
        body=body,
        content_sha256=sha256(body).hexdigest(),
        entry_name=entry.filename,
    )


def build_reference_client(timeout: httpx.Timeout) -> httpx.Client:
    """왜 redirect를 따르나: 관측된 다운로드가 attachment 응답을 바로 주지만, 정부 사이트가 파일
    전달을 CDN 경로로 옮기는 변화는 계약 위반이 아니라 전송 경로 변경이다."""
    return httpx.Client(timeout=timeout, follow_redirects=True)
