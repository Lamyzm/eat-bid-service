"""모듈 책임: eaT 상세 `ds_info`가 표시한 낙찰 조건(하한율·예정가격 방식·낙찰자 결정 방법)을 관측
그대로 eat-v2 정규화 모델로 옮긴다."""

from __future__ import annotations

from collections.abc import Mapping

from eatbid.generated.ingestion_v2 import NormalizedAuctionTerms
from eatbid.source.eat.code_schemes import (
    AWARD_METHOD,
    PLANNED_PRICE_TYPE,
    optional_scheme_value,
)
from eatbid.source.eat.wire_values_v2 import optional_bid_rate


def parse_auction_terms(info: Mapping[str, str]) -> NormalizedAuctionTerms:
    """조건은 `ds_info`가 표시한 것만 읽는다.

    `PLNPRCE_SUCBD_STD`는 "90"처럼 정수로 오지만 계약 정밀도는 소수 셋째 자리이므로 손실 없이
    90.000이 된다. 하한 금액이나 "하한 미달" 판정은 여기서 만들지 않는다 — 소스가 주는 것은 기준
    비율뿐이고, 그날의 하한 금액은 추첨 결과에서 파생되는 별개의 관측 파생값이다(AGENTS 3·8).

    `SUCBD_DECISION_MTHD_NM`은 "예정가격의 [90]%이상 입찰가 중 최저가 낙찰" 같은 렌더링된 문장이라
    코드 자리에 넣지 않는다. 짝이 되는 코드는 `ds_info`의 `SUCBID_DCSN_MTH_CD`이며 2026-09-04 레이크
    전수 238,306건 전부에 있다(003이 99%). 명단·이력 블록에 있는 `SUCBD_DECISION_MTHD`는 이름이
    비슷할 뿐 `ds_info`에는 없는 다른 블록의 column이라 여기서 끌어오지 않는다 — 그러면 블록 사이의
    동일성을 우리가 단언하게 된다.
    """
    return NormalizedAuctionTerms(
        floor_rate=optional_bid_rate(info, "PLNPRCE_SUCBD_STD"),
        planned_price_method=optional_scheme_value(info, PLANNED_PRICE_TYPE),
        award_method=optional_scheme_value(info, AWARD_METHOD),
    )
