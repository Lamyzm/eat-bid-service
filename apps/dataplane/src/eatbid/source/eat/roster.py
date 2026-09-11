"""모듈 책임: eaT 상세의 `ds_bidList` 명단 블록과 거기서 소스가 표시한 낙찰 판정을 관측 그대로
eat-v2 정규화 모델로 옮긴다."""

from __future__ import annotations

from collections.abc import Mapping

from eatbid.generated.ingestion_v2 import (
    NormalizedAwardDecision,
    NormalizedBidRoster,
    NormalizedBidSubmission,
    NormalizedSupplierAccount,
    SourceCode,
)
from eatbid.source.eat.code_schemes import (
    BID_STATUS,
    BUSINESS_NUMBER,
    SUPPLIER_ACCOUNT,
    WITHDRAWAL_FLAG,
    optional_scheme_value,
)
from eatbid.source.eat.wire_text import optional_text
from eatbid.source.eat.wire_values_v2 import (
    SOURCE_SYSTEM,
    optional_instant_text,
    optional_money,
    optional_nonnegative_count,
    optional_observed_bid_rate,
)
from eatbid.source.eat.xml import ParsedNexacro

BID_LIST_DATASET = "ds_bidList"
# 낙찰 판정 코드다. 소스의 `BID_STT`는 002 낙찰과 005 낙찰실패 둘뿐이고 "무효"나 "하한 미달"은 코드로
# 오지 않는다. 이름이 아니라 코드로 고르는 이유는 `BID_STT_NM`이 표시 문자열이라 언제든 바뀌기
# 때문이다(AGENTS 2).
AWARDED_STATUS_CODE = "002"
# 원본 순위 2를 그대로 2등으로 읽는다. "유효 투찰 중 두 번째"로 다시 세면 하한 판정을 우리가 만들게
# 되는데, 소스에는 그 판정이 없다(AGENTS 3·8).
#
# 여기서 읽는 순위는 `RNK` 하나다. 같은 블록에 `RNK2`·`RNK3`가 더 있고 셋은 서로 다른 값이지만
# **무엇이 다른지 모른다**(`docs/audit-source/SOURCE-FIELDS.md` T15). 모르는 축을 섞지 않으려고 하나만 읽는다.
# 낙찰자는 순위가 아니라 `BID_STT`가 정한다 — 공고당 정확히 한 행이다.
_RUNNER_UP_RANK = 2
_MAX_DRAW_NUMBERS = 8


def parse_bid_roster(parsed: ParsedNexacro) -> NormalizedBidRoster:
    """명단 블록을 읽는다. 블록이 없으면 빈 명단이며 그것은 실패가 아니다(AGENTS 3).

    유찰·취소·개찰 전 공고에는 이 블록이 아예 없다. 부재를 격리로 취급하면 정상적인 공고 수집이
    통째로 멈추므로, 여기서는 부재와 "블록은 있는데 행을 해석할 수 없음"을 구분한다. 뒤쪽만 예외다.
    """
    info = parsed.datasets["ds_info"][0]
    rows = parsed.datasets.get(BID_LIST_DATASET, ())
    return NormalizedBidRoster(
        source_roster_size=optional_nonnegative_count(info, "BID_CNT"),
        submissions=[_submission(row) for row in rows],
    )


def _submission(row: Mapping[str, str]) -> NormalizedBidSubmission:
    # `SAJEONG_PCT`는 소스가 계산한 값이라 예정가격 초과 투찰과 단가 입찰에서 100을 넘는다.
    # 하한율과 같은 0~100 타입으로 읽으면 그 관측이 통째로 격리된다(AGENTS 3).
    bid_rate = optional_observed_bid_rate(row, "SAJEONG_PCT")
    if bid_rate is None:
        raise ValueError("SAJEONG_PCT is required on an observed roster row")
    amount = optional_money(row, "BID_CALC_AMT")
    if amount is None:
        raise ValueError("BID_CALC_AMT is required on an observed roster row")
    # `EFT_ALL_AMT`를 `BID_CALC_AMT`의 중복으로 보고 버리지 마라. 하한 미달 투찰에서 소스는
    # `BID_CALC_AMT`를 1e13대 sentinel로 가리지만 `EFT_ALL_AMT`에는 실제 투찰금액을 남긴다
    # (`docs/audit-source/SOURCE-FIELDS.md` T14). 그래서 둘을 다른 자리에 싣는다. 이름이 비슷한 `ds_info`의
    # `EFT_ALL_AMT_ENC`는 다른 블록의 다른 필드이고 의미를 모른다 — 여기로 끌어오지 마라.
    status = optional_scheme_value(row, BID_STATUS)
    if status is None:
        raise ValueError("BID_STT is required on an observed roster row")
    return NormalizedBidSubmission(
        supplier_account=_supplier_account(row),
        submitted_at=optional_instant_text(row, "BID_DT", "%Y-%m-%d %H:%M:%S"),
        amount=amount,
        effective_amount=optional_money(row, "EFT_ALL_AMT"),
        bid_rate=bid_rate,
        rank=optional_nonnegative_count(row, "RNK"),
        source_status=status,
        withdrawal_flag=optional_scheme_value(row, WITHDRAWAL_FLAG),
        draw_numbers=_draw_numbers(row),
        observed_roster_size=optional_nonnegative_count(row, "TOTAL_NUM"),
    )


def _supplier_account(row: Mapping[str, str]) -> NormalizedSupplierAccount:
    account = optional_scheme_value(row, SUPPLIER_ACCOUNT)
    if account is None:
        raise ValueError("SHIPPER_CD is required on an observed roster row")
    # NARA_BIZ_NO는 사업자번호가 아니라 "부정당업자가 아닙니다." 같은 문장이라 읽지 않는다. 이름이
    # 코드처럼 보인다고 코드 자리에 넣으면 그 문장이 정체성이 된다.
    return NormalizedSupplierAccount(
        source_system=SOURCE_SYSTEM,
        account_code=account,
        business_number=optional_scheme_value(row, BUSINESS_NUMBER),
    )


def _draw_numbers(row: Mapping[str, str]) -> list[SourceCode]:
    """`DRAW_NO`는 한 업체가 고른 예비가격 번호 둘을 ', '로 이어 보낸다(실측 '7, 3').

    번호는 `ds_pList`의 후보 순번(`CMNM_PLNPRC_SN`)을 가리키는 코드이므로 문자열 그대로 싣는다.
    가리키는 쪽과 가리켜지는 쪽이 같은 `SourceCode`여야 둘을 맞대볼 수 있고, 정수로 바꿔 담으면
    소스가 앞자리 0을 붙이는 날 두 값이 서로 다른 것이 된다.
    """
    value = optional_text(row, "DRAW_NO")
    if value is None:
        return []
    numbers = [part.strip() for part in value.split(",")]
    if any(not part.isdecimal() or not part.isascii() for part in numbers):
        raise ValueError(
            "DRAW_NO must be a comma separated list of decimal draw numbers"
        )
    if len(numbers) > _MAX_DRAW_NUMBERS:
        raise ValueError("DRAW_NO must stay within the observed draw number bound")
    return [SourceCode(root=number) for number in numbers]


def parse_award_decision(
    parsed: ParsedNexacro, roster: NormalizedBidRoster
) -> NormalizedAwardDecision | None:
    """소스가 낙찰로 표시한 행 하나를 고른다. 없으면 낙찰 판정이 없는 관측이다.

    `SUCBD_DT`는 정규화된 명단 행에 자리가 없어 원본 행을 다시 봐야 한다. 명단 행과 원본 행을 순서로
    짝지으며, 길이가 어긋나면 `zip(strict=True)`가 조용한 어긋남 대신 실패로 끊는다.
    """
    rows = parsed.datasets.get(BID_LIST_DATASET, ())
    awarded = [
        (row, submission)
        for row, submission in zip(rows, roster.submissions, strict=True)
        if submission.source_status.code == AWARDED_STATUS_CODE
    ]
    if not awarded:
        return None
    if len(awarded) > 1:
        raise ValueError("an observed roster must carry a single award row")
    runner_up = next(
        (
            submission
            for submission in roster.submissions
            if submission.rank is not None and submission.rank.root == _RUNNER_UP_RANK
        ),
        None,
    )
    row, submission = awarded[0]
    return NormalizedAwardDecision(
        supplier_account=submission.supplier_account,
        awarded_at=optional_instant_text(row, "SUCBD_DT", "%Y%m%d"),
        awarded_rate=submission.bid_rate,
        awarded_amount=submission.amount,
        runner_up_rate=runner_up.bid_rate if runner_up is not None else None,
        source_status=submission.source_status,
    )
