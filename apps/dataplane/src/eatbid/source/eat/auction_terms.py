"""모듈 책임: eaT 상세 `ds_info`가 표시한 낙찰 조건(하한율·예정가격 방식·낙찰자 결정 방법)을 관측
그대로 eat-v2 정규화 모델로 옮긴다."""

from __future__ import annotations

from collections.abc import Mapping

from eatbid.generated.ingestion_v2 import NormalizedAuctionTerms
from eatbid.source.eat.wire_values_v2 import (
    optional_bid_rate,
    optional_source_coded_value,
)


def parse_auction_terms(info: Mapping[str, str]) -> NormalizedAuctionTerms:
    """조건은 `ds_info`가 표시한 것만 읽는다.

    `PLNPRCE_SUCBD_STD`는 "90"처럼 정수로 오지만 계약 정밀도는 소수 셋째 자리이므로 손실 없이
    90.000이 된다. 하한 금액이나 "하한 미달" 판정은 여기서 만들지 않는다 — 소스가 주는 것은 기준
    비율뿐이고, 그날의 하한 금액은 추첨 결과에서 파생되는 별개의 관측 파생값이다(AGENTS 3·8).

    `SUCBD_DECISION_MTHD_NM`은 "예정가격의 [90]%이상 입찰가 중 최저가 낙찰" 같은 렌더링된 문장이라
    코드 자리에 넣지 않는다. `ds_info`에 짝이 되는 코드가 없으면 `awardMethod`는 관측되지 않은
    것이며, 명단 행의 같은 이름 column에서 끌어오면 블록 사이의 동일성을 우리가 단언하게 된다.
    """
    return NormalizedAuctionTerms(
        floor_rate=optional_bid_rate(info, "PLNPRCE_SUCBD_STD"),
        planned_price_method=optional_source_coded_value(
            info,
            "PLNPRC_TYPE_CD",
            code_scheme="eat:PLNPRC_TYPE_CD",
            label_field="PLNPRCE_TYPE_NM",
        ),
        award_method=optional_source_coded_value(
            info,
            "SUCBD_DECISION_MTHD",
            code_scheme="eat:SUCBD_DECISION_MTHD",
            label_field="SUCBD_DECISION_MTHD_NM",
        ),
    )
