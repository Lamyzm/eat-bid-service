"""모듈 책임: 읽기 전용 eaT 목록 프로브들이 공유하는 요청·응답 해석 도구를 한곳에서 소유한다.

왜 별도 모듈인가. `probe_eat_list.py`와 `probe_eat_open_questions.py`는 묻는 질문이 다르지만
목록 응답을 얻고 Nexacro Dataset을 행으로 펴는 방법은 하나여야 한다. 두 스크립트가 각자 파싱하면
같은 관측을 두 방식으로 읽게 되고 증거 문서의 숫자가 어느 해석에서 나왔는지 알 수 없게 된다.
어느 경로도 R2와 PostgreSQL을 건드리지 않으며 원본 보존은 `eatbid capture`의 책임으로 남는다.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from uuid import uuid4
from xml.etree import ElementTree

import httpx

from eatbid.ingest.models import CaptureRequest
from eatbid.source.eat.http_client import (
    ACCEPT_HEADER,
    CONTENT_TYPE_HEADER,
    USER_AGENT_HEADER,
    WARMUP_PATH,
    EatHttpClient,
)
from eatbid.source.eat.payload import MAX_PAGE_SIZE_ROWS
from eatbid.source.eat.registry import EAT_ORIGIN, require_transport

DATASET_NS = "{http://www.nexacroplatform.com/platform/dataset}"

ListRows = tuple[list[str], list[dict[str, str]]]


def parse_rows(body: bytes) -> ListRows:
    """응답의 첫 Dataset을 선언 컬럼과 행 dict로 편다."""
    root = ElementTree.fromstring(body.decode("utf-8"))
    dataset = root.find(f"{DATASET_NS}Dataset")
    if dataset is None:
        raise SystemExit("응답에 Dataset이 없다")
    columns = [
        column.attrib["id"]
        for column in dataset.iter(f"{DATASET_NS}Column")
        if "id" in column.attrib
    ]
    rows = [
        {cell.attrib["id"]: (cell.text or "") for cell in row if "id" in cell.attrib}
        for row in dataset.iter(f"{DATASET_NS}Row")
    ]
    return columns, rows


def fetch_page(
    *, start_date: str, end_date: str, page_size: int, page: int, region_code: str
) -> ListRows:
    """검토된 전송 계약으로 목록 한 페이지를 읽는다."""
    transport = require_transport("bid-list")
    params = transport.build_page_params(
        start_date=start_date,
        end_date=end_date,
        progress_status_code="",
        region_code=region_code,
        page_number=page,
        page_size=page_size,
    )
    request = CaptureRequest(
        request_unit_id=1,
        run_id=uuid4(),
        source="eat",
        endpoint="bid-list",
        params=params,
    )
    with EatHttpClient() as client:
        response = client.fetch(request)
    if response.status_code != 200:
        raise SystemExit(f"HTTP {response.status_code}")
    return parse_rows(response.body)


def total_count(rows: Sequence[Mapping[str, str]]) -> str:
    totals = {row.get("TOT_CNT", "") for row in rows}
    return totals.pop() if len(totals) == 1 else f"불일치 {totals}"


def endpoint_headers() -> dict[str, str]:
    """`EatHttpClient`가 쓰는 것과 같은 요청 헤더를 공개 상수만으로 다시 만든다."""
    return {
        "Accept": ACCEPT_HEADER,
        "Content-Type": CONTENT_TYPE_HEADER,
        "Origin": EAT_ORIGIN,
        "Referer": f"{EAT_ORIGIN}{WARMUP_PATH}",
        "User-Agent": USER_AGENT_HEADER,
        "X-Requested-With": "XMLHttpRequest",
    }


def fetch_with_raw_page_size(
    *, start_date: str, end_date: str, page_size: int, region_code: str
) -> httpx.Response:
    """검토된 `PAGE_SIZE` 상한(1000)을 넘겨 소스가 무엇으로 답하는지만 관측한다.

    왜 계약 builder를 우회하나. `build_bid_list_payload`는 1000 초과를 우리 쪽에서 거부하므로
    그 경로로는 소스의 상한을 물어볼 수 없다. 그 값이 우리 정책인지 소스 정책인지 모른 채 두면
    backfill 페이지 계획이 근거 없는 상수 위에 서게 된다. 이 함수는 프로브 전용이며 수집 경로가
    쓰지 않는다.
    """
    if page_size <= MAX_PAGE_SIZE_ROWS:
        raise SystemExit(
            f"{MAX_PAGE_SIZE_ROWS} 이하는 계약 경로로 물어라: fetch_page(page_size={page_size})"
        )
    transport = require_transport("bid-list")
    payload = transport.build_payload(
        transport.build_page_params(
            start_date=start_date,
            end_date=end_date,
            progress_status_code="",
            region_code=region_code,
            page_number=1,
            page_size=MAX_PAGE_SIZE_ROWS,
        )
    )
    raw = payload.replace(
        f'<Col id="PAGE_SIZE">{MAX_PAGE_SIZE_ROWS}</Col>'.encode(),
        f'<Col id="PAGE_SIZE">{page_size}</Col>'.encode(),
    )
    if raw == payload:
        raise SystemExit("PAGE_SIZE 치환에 실패했다 — payload 형태가 바뀌었다")
    with httpx.Client(timeout=30.0, follow_redirects=False) as client:
        client.get(f"{EAT_ORIGIN}{WARMUP_PATH}", headers={"User-Agent": USER_AGENT_HEADER})
        return client.post(
            f"{EAT_ORIGIN}{transport.path}",
            headers=endpoint_headers(),
            content=raw,
        )
