"""모듈 책임: eaT 상세의 `ds_pList` 복수예정가격 추첨 후보 블록을 관측 그대로 eat-v2 정규화
모델로 옮긴다."""

from __future__ import annotations

from eatbid.generated.ingestion_v2 import (
    NormalizedReservePriceCandidate,
    NormalizedReservePriceDraw,
)
from eatbid.source.eat.wire_text import optional_text
from eatbid.source.eat.wire_values_v2 import (
    optional_money,
    optional_reserve_price_ratio,
    optional_source_coded_value,
)
from eatbid.source.eat.xml import ParsedNexacro

P_LIST_DATASET = "ds_pList"


def parse_reserve_price_draw(parsed: ParsedNexacro) -> NormalizedReservePriceDraw:
    """추첨 후보를 원본 순서대로 담는다. 블록이 없으면 빈 후보이며 실패가 아니다.

    `CHC_YN=Y`인 후보들의 평균이 `ds_info.ELCTRN_BID_PLNPRC`와 같다는 것은 소스에서 확인한
    불변식이지만, 예정가격은 계속 관측값을 싣는다. 여기서 평균을 계산해 채우면 관측과 해석이
    섞이고 소스가 규칙을 바꾼 날을 알아챌 수 없게 된다(AGENTS 3).
    """
    candidates: list[NormalizedReservePriceCandidate] = []
    # 순번은 후보를 가리키는 소스 코드이므로 원본 문자열 그대로 비교하고 담는다. 정수로 바꾸면
    # 명단 행의 `DRAW_NO`가 가리키는 값과 타입이 갈리고, 앞자리 0이 붙는 날 값이 달라진다.
    sequences: set[str] = set()
    for row in parsed.datasets.get(P_LIST_DATASET, ()):
        sequence = optional_text(row, "CMNM_PLNPRC_SN")
        if sequence is None:
            raise ValueError("CMNM_PLNPRC_SN is required on an observed draw row")
        if sequence in sequences:
            raise ValueError("CMNM_PLNPRC_SN must be unique within a draw")
        sequences.add(sequence)
        ratio = optional_reserve_price_ratio(row, "CMNM_PLNPRC_RT")
        if ratio is None:
            raise ValueError("CMNM_PLNPRC_RT is required on an observed draw row")
        amount = optional_money(row, "CMNM_PLNPRC")
        if amount is None:
            raise ValueError("CMNM_PLNPRC is required on an observed draw row")
        chosen = optional_source_coded_value(row, "CHC_YN", code_scheme="eat:CHC_YN")
        if chosen is None:
            raise ValueError("CHC_YN is required on an observed draw row")
        candidates.append(
            NormalizedReservePriceCandidate(
                sequence=sequence, ratio=ratio, amount=amount, chosen=chosen
            )
        )
    return NormalizedReservePriceDraw(candidates=candidates)
