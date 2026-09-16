"""모듈 책임: eaT 상세 파서가 싣는 code scheme의 의미 이름과 그 이름을 관측할 소스 column 짝, 그리고
eaT 공통 코드목록 그룹이 어느 체계에 이름을 주는지의 단일 권위를 갖고, 그 표대로 관측 코드를 읽는다."""

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
# 문장 안 대괄호에 하한율 숫자가 박혀 있어 `ds_info`의 어떤 코드도 이 이름을 결정하지 못한다. 결정
# 방법은 이 코드와 `PLNPRCE_SUCBD_STD` 둘로만 정해지므로 **이름을 파싱하지 마라**
# (`docs/audit-source/SOURCE-FIELDS.md` T16). 목록 응답에서는 그 대괄호가 아예 비어 있다.
AWARD_METHOD = EatCodeScheme(
    "eat:award-method", "SUCBID_DCSN_MTH_CD", "SUCBD_DECISION_MTHD_NM"
)
# 단독입찰 처리 방법이다. 값은 둘뿐이고(`허용안함`이 99.8%, 2026-09-16 전수 181,150건) 참여 0곳의 뜻을 바꾼다 —
# 허용안함이면 혼자 들어가면 유찰이다. 라벨은 `_NM`이 함께 오므로 코드목록 없이도 이름이 관측된다(EAT-249).
# 이름이 `SGNS`(single)로 시작해도 `MN_TRMT_LMT_YN`과 헷갈리지 마라 — 그쪽은 품목 존재 여부다(SOURCE-FIELDS T13).
SOLO_BID_METHOD = EatCodeScheme(
    "eat:solo-bid-method", "SGNS_BID_PRCS_MTHD_CD", "SGNS_BID_PRCS_MTHD_CD_NM"
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
# ⚠ 지역은 두 축이다(`docs/audit-source/SOURCE-FIELDS.md` T1). 여기 둘은 **급식을 먹는 학교가 어디 있는가**이고,
# 아래 `ELIGIBILITY_AREA`는 **어느 지역 업체가 응찰할 수 있는가**다. 경기 공고의 참가제한지역이
# 서울인 건이 실제로 있으므로 두 축을 같은 "지역"으로 묶으면 자격 판정이 틀린다. 자릿수가 비슷하다고
# `SIDO_CD`와 `CTPV_CD`를 같은 값으로 보지도 마라 — 형식도 값 집합도 다르다(T2).
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
# ⚠ 같은 블록의 `SGG_CD`를 시군구 코드로 쓰지 마라(`docs/audit-source/SOURCE-FIELDS.md` T3). 전국 시군구보다
# 훨씬 적은 값으로 뭉쳐 있고 한 코드가 여러 이름을 갖는다. 짝인 `SGG_NM`은 두 글자로 잘린 이름과
# 온전한 이름이 섞여 이름 매칭도 깨진다. 참가자격의 시군구는 `PDLC_CD`이고, 학교 위치의 시군구는
# 위 `AUCTION_LOCATION_SIGUNGU`다 — 둘은 서로 다른 어휘다. `SGG_CD`라는 이름은 `ds_compList`와
# 계약현황 API에도 있는데 값 공간이 또 다르다.
#
# 라벨 `PDLC_NM`은 `{시도 축약}/{시군구|전체}` 형태이며 전수 327,168행에 100% 채워져 있다
# (`docs/audit-source/census-detail.txt` §ds_areaList). 이름 다중 79건은 전부 `서울 / 전체`와
# `서울/전체`의 공백 변이라 `code_labels.normalize_code_label` 하나로 흡수된다. 이 체계가 지역 축에서
# 유일하게 이름 경로를 관측하므로 행안부 대조의 입력도 여기서 나온다(ADR 0035 결정 6). 코드 목록은
# 모든 parser version이 `eligibilityCodes`로 싣고, 라벨은 eat-v3부터 `optional_scheme_value`로 읽어
# `eligibilityAreas`에 얹는다(ADR 0038).
ELIGIBILITY_AREA = EatCodeScheme("eat:eligibility-area", "PDLC_CD", "PDLC_NM")

# 구매기관의 유형이다. 이 체계는 상세 응답 어디에도 오지 않고 공통 코드목록(BC016)에서만 관측된다.
# 그래서 column 짝도 코드목록의 것이며, 상세 파서는 이 체계를 읽지 않는다.
#
# ⚠ `core.organization.type`에 이 코드를 잇지 않는다. 잇는 데 필요한 것은 "이 구매기관이 저 유형이다"
# 라는 관측인데 우리는 그것을 받은 적이 없다 — 상세의 `PURR_CD`·`PURR_NM` 어디에도 유형 코드가 없다.
# 기관 이름에서 유형을 추정하는 것은 문자열을 정체성으로 쓰는 일이자 관측과 해석을 섞는 일이다
# (AGENTS 2·3). 그 연결은 유형을 주는 관측을 찾은 뒤의 별도 작업이다.
ORGANIZATION_TYPE = EatCodeScheme("eat:organization-type", "CMNS_CD", "CMNS_CD_NM")

# 상세 파서가 `optional_scheme_value`로 직접 읽어 정규화 모델에 싣는 체계다.
# 시드 `packages/db/src/seeds/code-schemes.ts`와 같은지 `tests/unit/test_code_schemes.py`가 고정한다.
EAT_CODE_SCHEMES: tuple[EatCodeScheme, ...] = (
    BID_STATUS,
    WITHDRAWAL_FLAG,
    SUPPLIER_ACCOUNT,
    BUSINESS_NUMBER,
    PLANNED_PRICE_TYPE,
    AWARD_METHOD,
    SOLO_BID_METHOD,
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

# 공통 코드목록에서만 관측되는 체계다. 위 두 표와 나누는 이유는 이 체계가 공고 응답의 column에서
# 오지 않기 때문이며, 그래서 상세 파서도 core 발행 완결성 검사도 이 이름을 요구하지 않는다.
CODE_LIST_CODE_SCHEMES: tuple[EatCodeScheme, ...] = (ORGANIZATION_TYPE,)

ALL_EAT_CODE_SCHEMES: tuple[EatCodeScheme, ...] = (
    *EAT_CODE_SCHEMES,
    *FOUNDATION_CODE_SCHEMES,
    *CODE_LIST_CODE_SCHEMES,
)

# 위 전부와 달리 이 체계만 `EatCodeScheme`이 아니다. eaT는 품목을 코드로 주지 않고 `MAIN_ITEMS` 라벨
# 문자열 하나로만 주므로 짝지을 소스 column이 없고, 코드를 발급하는 주체가 우리다. 이름과 원자 목록의
# 값 권위는 `packages/db/src/seeds/`이며 여기는 dataplane이 그 이름을 부르는 단일 참조점이다
# (`tests/unit/test_code_schemes.py`가 두 파일을 읽어 일치를 고정한다).
AUCTION_ITEM_SCHEME = "eatbid:auction-item"

# 과거 전체 revision의 라벨을 쉼표로 쪼갠 결과가 이 여덟으로 닫힌다(2026-09-16 전수 실측). 순서는
# 시드와 같게 두어 두 목록을 눈으로 대조할 수 있게 한다.
AUCTION_ITEM_ATOMS: tuple[str, ...] = (
    "가공식품",
    "육류",
    "농산물",
    "수산물",
    "가금류",
    "김치류",
    "곡류",
    "우유류",
)


@dataclass(frozen=True, slots=True)
class EatCodeListGroup:
    """eaT 공통 코드목록 그룹 하나와 그것이 이름을 주는 code scheme의 짝이다.

    왜 그룹 번호가 정체성이 아닌가. `SC066`은 eaT 운영 화면이 콤보를 채울 때 쓰는 요청 열쇠일 뿐이고,
    같은 어휘를 다른 그룹 번호로 옮겨 실어도 우리가 이미 발행한 `(source_system, code_scheme, code)`는
    그대로여야 한다. 그래서 정체성은 `scheme`이고 그룹 번호는 "지금 어디서 받고 있는가"다(AGENTS 2).
    """

    group_code: str
    scheme: EatCodeScheme
    # 이 그룹의 행이 상위 코드를 싣는 column과 그 상위가 속한 그룹이다. 둘 다 없으면 상위를 읽지 않는다.
    # column 이름이 아니라 그룹마다 따로 적는 이유는 아래 경고 그대로다 — 같은 `ITM_VL2`가 그룹마다 다른 뜻이다.
    parent_column: str | None = None
    parent_group: str | None = None


# 2026-09-16 실측으로 고정한 네 그룹이다. 그룹을 늘리는 것은 새 관측을 여는 결정이므로 이 표를 고치는
# 커밋에서만 일어난다. 요청 payload도 이 표에서 나오므로 "무엇을 물었는가"와 "무엇으로 읽는가"가
# 갈라지지 않는다.
#
# ⚠ `ITM_VL2`를 그룹에 상관없이 상위 코드로 읽지 마라. `SC067`에서는 부모 시도 코드가 맞지만
# (`653=김해시`, `ITM_VL2=15`), `BC016`에서는 같은 자리가 `001`·`002`·`003`이라는 **묶음 번호**이고
# 그 값은 BC016 코드가 아니다(`010 학교`의 `ITM_VL2=002`는 `002 광역지자체`를 가리키지 않는다).
# 한 이름을 그룹에 상관없이 같은 뜻으로 읽으면 학교의 상위가 광역지자체가 된다(AGENTS 6).
EAT_CODE_LIST_GROUPS: tuple[EatCodeListGroup, ...] = (
    EatCodeListGroup("SC066", AUCTION_LOCATION_SIDO),
    EatCodeListGroup("SC067", AUCTION_LOCATION_SIGUNGU, parent_column="ITM_VL2", parent_group="SC066"),
    EatCodeListGroup("EP049", ATTEMPT_STATUS),
    EatCodeListGroup("BC016", ORGANIZATION_TYPE),
)

EAT_CODE_LIST_GROUP_CODES: tuple[str, ...] = tuple(
    group.group_code for group in EAT_CODE_LIST_GROUPS
)


def code_list_group(group_code: str) -> EatCodeListGroup | None:
    """검토된 그룹 하나를 돌려준다. 검토되지 않은 그룹은 `None`이다."""
    for group in EAT_CODE_LIST_GROUPS:
        if group.group_code == group_code:
            return group
    return None


def code_list_scheme(group_code: str) -> EatCodeScheme | None:
    """그룹 번호가 이름을 주는 체계를 돌려준다. 검토되지 않은 그룹은 `None`이다."""
    group = code_list_group(group_code)
    return None if group is None else group.scheme


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
