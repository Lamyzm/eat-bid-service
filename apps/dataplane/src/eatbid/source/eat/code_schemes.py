"""모듈 책임: eaT 상세 파서가 싣는 code scheme의 의미 이름과 그 이름을 관측할 소스 column 짝의
단일 권위를 갖고, 그 표대로 관측 코드를 읽는다."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

from eatbid.generated.ingestion_v2 import SourceCodedValue
from eatbid.source.eat.wire_values_v2 import optional_source_coded_value


@dataclass(frozen=True, slots=True)
class EatCodeScheme:
    """code scheme 하나의 정체성(`namespace`)과 그것이 관측되는 소스 column 짝.

    왜 namespace가 소스 column명이 아닌가. `BID_STT` 같은 column명은 이 코드 체계를 지금 어디서
    받고 있는지를 말하는 메타데이터일 뿐 정체성이 아니다. column명을 정체성으로 쓰면 소스가 같은
    체계를 다른 column으로 옮겨 보내는 날 이미 발행된 `(source_system, code_scheme, code)`가 끊기고,
    같은 체계를 두 이름으로 부르게 된다 — `SHIPPER_CD`와 `supplier-account`가 실제로 그랬다
    (AGENTS 2·6).
    """

    namespace: str
    source_column: str
    label_column: str | None = None


# 투찰 한 건의 낙찰 판정이다. 실측은 002 낙찰과 005 낙찰실패 둘뿐이지만 열거로 막지 않는다.
BID_STATUS = EatCodeScheme("eat:bid-status", "BID_STT", "BID_STT_NM")

# 투찰 철회 여부(Y/N)다. 철회는 투찰의 상태이지 낙찰 판정이 아니라서 `eat:bid-status`와 별개 체계다.
WITHDRAWAL_FLAG = EatCodeScheme("eat:withdrawal-flag", "WITHDRAWAL_YN")

# 소스가 부여한 업체 계정 코드다. 시드가 이미 `eat:supplier-account`로 등록해 둔 것과 같은 체계이며,
# 파서가 `eat:SHIPPER_CD`로 따로 부르던 것을 여기로 합쳤다. 계정 코드는 `SupplierParty` 정체성이
# 아니고 승격은 projector의 별도 정책이다.
SUPPLIER_ACCOUNT = EatCodeScheme("eat:supplier-account", "SHIPPER_CD", "SHIPPER_NM")

# 사업자등록번호다. 국세청이 소유하는 번호지만 우리가 받는 경로는 eaT이므로 출처 체계는 eaT로 둔다.
# 다른 소스에서 온 같은 자릿수 문자열과 매핑 없이 같다고 보지 않는다(AGENTS 6).
BUSINESS_NUMBER = EatCodeScheme("eat:business-number", "BIZ_NO")

# 예정가격 산정 방식(001 단일·002 복수예정가격)이다.
PLANNED_PRICE_TYPE = EatCodeScheme(
    "eat:planned-price-type", "PLNPRC_TYPE_CD", "PLNPRCE_TYPE_NM"
)

# 낙찰자 결정 방법이다. 짝이 되는 라벨 `SUCBD_DECISION_MTHD_NM`은 렌더링된 문장이라 코드가 아니다.
AWARD_METHOD = EatCodeScheme(
    "eat:award-method", "SUCBID_DCSN_MTH_CD", "SUCBD_DECISION_MTHD_NM"
)

# 복수예정가격 후보 15개 중 그 회차 추첨에 뽑혔는지(Y/N)다. "선택 여부"라는 의미는 실측으로 확인했다:
# 전수 2,715,210행에 Y/N 두 값만 있고(`docs/audit-source/census-detail.txt`), 회차마다 정확히 4행이
# Y이며 그 4개 비율의 산술 평균이 `ds_info.ELCTRN_BID_PLNPRC`와 일치한다
# (`docs/experiments/2026-09-02-mechanism-verdict.md` §전수 233,204회차, 잔차 95건 0.041%).
# 그래서 임시 이름 `eat:choice-flag`가 아니라 관측된 의미를 그대로 쓴다.
RESERVE_PRICE_SELECTION_FLAG = EatCodeScheme(
    "eat:reserve-price-selection-flag", "CHC_YN"
)

# 공고 시도 하나의 상태다. 실측 값이 007 낙찰·009 유찰·003 입찰공고
# (`docs/audit-source/census-detail.txt:98`)라 투찰이 아니라 회차 자체의 상태이며, 그래서 이름도
# `AuctionAttempt`의 어휘를 따른다(AGENTS 4). 지금은 `ds_bidHistory`의 재입찰 사슬 행에서만
# 관측되지만 사슬은 이 체계가 어디서 보이는지일 뿐 정체성이 아니다. 투찰 한 건의 판정인
# `eat:bid-status`와는 grain이 달라 같은 체계로 묶지 않는다(AGENTS 6).
ATTEMPT_STATUS = EatCodeScheme("eat:attempt-status", "ETN_BID_STT", "ETN_BID_STT_NM")

# 구매기관 코드다. 라벨 `PURR_NM`은 이름 관측이지 정체성이 아니라서 `core.code_label_observation`으로
# 간다(AGENTS 2).
ORGANIZATION = EatCodeScheme("eat:organization", "PURR_CD", "PURR_NM")

# 공고지역 시도·시군구다. 행정안전부 행정구역과 별개 체계이며 명시적 매핑 없이 같다고 보지 않는다
# (AGENTS 6).
#
# 왜 이 둘만 라벨 column이 없나. 소스가 주지 않아서다. `ds_info` 전수 181,150행에 `SIDO_NM`·
# `SIGUNGU_NM`이 아예 없다(`docs/audit-source/census-detail.txt` §ds_info). 이름을 붙이려면 주소
# 문자열을 쪼개거나 `PDLC_CD` 자릿수를 분해해야 하는데 둘 다 기각된 경로다(PDR-0001, ADR 0035
# Rejected alternatives). 라벨이 없으면 이 두 체계는 결정적 일치의 입력이 없고, 매핑 결과는 그것을
# `without_label`로 따로 센다 — 조용히 0이 되지 않는다.
AUCTION_LOCATION_SIDO = EatCodeScheme("eat:auction-location-sido", "SIDO_CD")
AUCTION_LOCATION_SIGUNGU = EatCodeScheme("eat:auction-location-sigungu", "SIGUNGU_CD")

# 참가제한지역이다. 공고지역과 같은 자릿수 문자열이 와도 다른 체계다(AGENTS 6).
#
# 라벨 `PDLC_NM`은 `{시도 축약}/{시군구|전체}` 형태이며 전수 327,168행에 100% 채워져 있다
# (`docs/audit-source/census-detail.txt` §ds_areaList). 이름 다중 79건은 전부 `서울 / 전체`와
# `서울/전체`의 공백 변이라 `code_labels.normalize_code_label` 하나로 흡수된다. 이 체계가 지역 축에서
# 유일하게 이름 경로를 관측하므로 행안부 대조의 입력도 여기서 나온다(ADR 0035 결정 6). 코드 목록은
# 모든 parser version이 `eligibilityCodes`로 싣고, 라벨은 eat-v3부터 `optional_scheme_value`로 읽어
# `eligibilityAreas`에 얹는다(ADR 0038).
ELIGIBILITY_AREA = EatCodeScheme("eat:eligibility-area", "PDLC_CD", "PDLC_NM")

# 상세 파서가 `optional_scheme_value`로 직접 읽어 정규화 모델에 싣는 체계다.
# 시드 `packages/db/src/seeds/code-schemes.ts`와 같은지 `tests/unit/test_code_schemes.py`가 고정한다.
EAT_CODE_SCHEMES: tuple[EatCodeScheme, ...] = (
    BID_STATUS,
    WITHDRAWAL_FLAG,
    SUPPLIER_ACCOUNT,
    BUSINESS_NUMBER,
    PLANNED_PRICE_TYPE,
    AWARD_METHOD,
    RESERVE_PRICE_SELECTION_FLAG,
    ATTEMPT_STATUS,
)

# core 투영·발행 완결성 검사가 이름으로 요구하는 체계다. 위 표와 나누는 이유는 이 넷의 코드가
# `SourceCodedValue` 밖의 자리(`buyer`·`location`의 코드 문자열)로 먼저 실리기 때문이며, 정체성과 관측
# column의 단일 출처라는 성질은 두 표가 같다. `ELIGIBILITY_AREA`의 라벨만 eat-v3가 `optional_scheme_value`로
# 덧붙인다.
FOUNDATION_CODE_SCHEMES: tuple[EatCodeScheme, ...] = (
    ORGANIZATION,
    AUCTION_LOCATION_SIDO,
    AUCTION_LOCATION_SIGUNGU,
    ELIGIBILITY_AREA,
)

ALL_EAT_CODE_SCHEMES: tuple[EatCodeScheme, ...] = (
    *EAT_CODE_SCHEMES,
    *FOUNDATION_CODE_SCHEMES,
)


def optional_scheme_value(
    row: Mapping[str, str], scheme: EatCodeScheme
) -> SourceCodedValue | None:
    """표에 적힌 column 짝으로 관측 코드를 읽는다. 코드가 없으면 `None`이며 실패가 아니다.

    파서가 column 이름과 scheme 이름을 각각 적으면 둘이 어긋나도 아무도 모른다. 여기서 한 번에
    꺼내야 "이 scheme은 이 column에서 온다"가 한 곳에만 남는다.
    """
    return optional_source_coded_value(
        row,
        scheme.source_column,
        code_scheme=scheme.namespace,
        label_field=scheme.label_column,
    )
