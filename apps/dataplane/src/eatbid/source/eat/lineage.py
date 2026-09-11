"""모듈 책임: eaT 상세의 `ds_bidHistory` 재입찰 사슬과 `ds_info`의 직전 차수 참조를 관측 그대로
eat-v2 정규화 모델로 옮긴다."""

from __future__ import annotations

from collections.abc import Mapping

from eatbid.generated.ingestion_v2 import (
    DisplayBidNumber,
    ExternalBidId,
    NormalizedAttemptLink,
    NormalizedAuctionLineage,
)
from eatbid.source.eat.code_schemes import ATTEMPT_STATUS, optional_scheme_value
from eatbid.source.eat.wire_text import optional_text, required_text
from eatbid.source.eat.wire_values_v2 import optional_instant_text, optional_money
from eatbid.source.eat.xml import ParsedNexacro

BID_HISTORY_DATASET = "ds_bidHistory"


def parse_lineage(
    parsed: ParsedNexacro, info: Mapping[str, str]
) -> NormalizedAuctionLineage:
    """사슬을 원본 식별자로만 잇는다.

    공고번호 `ETN_BID_NO`의 끝자리(`-0`, `-1`, `-2`)가 차수처럼 보이지만 읽지 않는다. 문자열 접미사를
    순서로 해석하는 순간 표시값이 관계의 정체성이 된다(AGENTS 2·4). `UP_ELCTRN_BID_ID`는 바로 앞
    차수 하나만 가리키고, 원 공고까지의 전체 사슬은 `ds_bidHistory` 행들이 준다.

    **`RBID_YN`을 재입찰 신호로 쓰지 마라**(`docs/SOURCE-FIELDS.md` T13). 이름과 달리 일반공고에서도
    대부분 `Y`여서 그것으로 거르면 거의 전부가 통과한다. 재입찰 표시는 `CHG_TP_NM`과 그 짝 코드
    `PBANC_CHG_GB_CD`이며, 사슬 연결 자체는 여기 있는 `UP_ELCTRN_BID_ID`와 이 블록의 행이다.

    이 블록의 `PLNPRCE_SUCBD_STD`도 읽지 않는다. 상세의 같은 이름과 여집합이라 한 자리에 담으면
    하한율이 뒤집힌다(T4).
    """
    links: list[NormalizedAttemptLink] = []
    seen: set[str] = set()
    for row in parsed.datasets.get(BID_HISTORY_DATASET, ()):
        external_bid_id = required_text(row, "ETN_BID_ID")
        if external_bid_id in seen:
            raise ValueError("ETN_BID_ID must be unique within a re-bid chain")
        seen.add(external_bid_id)
        display_bid_number = optional_text(row, "ETN_BID_NO")
        links.append(
            NormalizedAttemptLink(
                external_bid_id=external_bid_id,
                display_bid_number=(
                    DisplayBidNumber(root=display_bid_number)
                    if display_bid_number is not None
                    else None
                ),
                source_status=optional_scheme_value(row, ATTEMPT_STATUS),
                bid_opened_from=optional_instant_text(
                    row, "BID_STRT_DT", "%Y%m%d%H%M%S"
                ),
                bid_closed_at=optional_instant_text(row, "BID_END_DT", "%Y%m%d%H%M%S"),
                base_amount=optional_money(row, "STRPRCE"),
                planned_amount=optional_money(row, "PLNPRCE"),
            )
        )
    parent = optional_text(info, "UP_ELCTRN_BID_ID")
    return NormalizedAuctionLineage(
        parent_external_bid_id=ExternalBidId(root=parent) if parent else None,
        links=links,
    )
