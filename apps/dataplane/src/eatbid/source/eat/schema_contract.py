"""모듈 책임: 검토된 eaT 응답 schema와 fingerprint의 단일 권위를 제공한다."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, replace
from types import MappingProxyType

from eatbid.source.eat.xml import schema_fingerprint


@dataclass(frozen=True, slots=True)
class ReviewedSchemaContract:
    """검토된 응답 schema. `datasets`는 파서가 아는 전체, `required`는 없으면 못 만드는 최소다.

    왜 둘로 나누나. 2026-09-03 실측에서 live 상세 응답은 공고 유형에 따라 dataset과 column이 붙거나
    빠져 같은 창 85건이 전체 모양 fingerprint를 12가지로 갈랐다. 전체 모양을 계약으로 삼으면 어떤
    live 수집도 발행되지 않는다. 계약이 지켜야 하는 것은 기본 사실을 만들 수 있느냐이므로 fingerprint는
    `required`로만 계산한다. 선택적 column의 부재나 모르는 column의 존재는 해석에 쓰지 않으므로
    추측을 들이지 않는다.
    """

    source: str
    endpoint: str
    parser_version: str
    datasets: Mapping[str, tuple[str, ...]]
    required: Mapping[str, tuple[str, ...]] | None = None

    @property
    def required_datasets(self) -> Mapping[str, tuple[str, ...]]:
        return self.datasets if self.required is None else self.required

    @property
    def fingerprint(self) -> str:
        return schema_fingerprint(self.required_datasets)


# 목록 dataset의 알려진 전체 column 38개다. 근거는 `docs/audit-source/census-list.txt`(아카이브 54개
# 응답 35,079행 전수, 전 column 채움률 100%)와 2026-09-03 live 실측(EAT-34)이다. 파서가 읽지 않는
# column도 여기 두는 이유는 소스가 column을 더하거나 빼는 변화를 원본 대비로 알아채기 위해서다.
_EAT_V1_BID_LIST_COLUMNS = (
    "BID_CNT",
    "BID_END_DT",
    "BID_NM",
    "BID_NUM_LIMIT_CNT",
    "BID_NUM_LIMIT_YN",
    "BID_STRT_DT",
    "BID_TYPE",
    "BID_TYPE_NM",
    "DLVRY_END_DT",
    "DLVRY_PLACE",
    "DLVRY_STRT_DT",
    "DLVRY_TIME",
    "ETN_BID_ID",
    "ETN_BID_NO",
    "ETN_BID_STT",
    "ETN_BID_STT_NM",
    "FRST_RGTR_ID",
    "LAST_CHGR_ID",
    "LAST_CHG_DT",
    "LIMIT_CONDITION",
    "LIMIT_CONDITION_NM",
    "PBANC_YMD",
    "PLNPRCE",
    "PLNPRCE_SUCBD_STD",
    "PLNPRCE_TYPE",
    "PLNPRCE_TYPE_NM",
    "PURR_CD",
    "PURR_NM",
    "RN",
    "ROW_NUM",
    "SOLO_BID_TRT_MTHD",
    "SOLO_BID_TRT_MTHD_NM",
    "STRPRCE",
    "STRPRCE_OPEN_YN",
    "SUCBD_DECISION_MTHD",
    "SUCBD_DECISION_MTHD_NM",
    "TOT_CNT",
    "USE_YN",
)

_EAT_V1_BID_LIST = ReviewedSchemaContract(
    source="eat",
    endpoint="bid-list",
    parser_version="eat-v1",
    datasets=MappingProxyType({"ds_list": _EAT_V1_BID_LIST_COLUMNS}),
    # 목록 파서가 `required_text`로 읽는 여섯이다. 총건수와 ID는 발견 manifest를, 경쟁자 수·상태·마감·
    # 소스 변경 시각은 ADR 0030의 경쟁자 수 추적을 상세 재호출 없이 만든다. 이 밖의 column은
    # nullable로 읽거나 읽지 않으므로 없어도 목록 사실을 만들 수 있다.
    required=MappingProxyType(
        {
            "ds_list": (
                "TOT_CNT",
                "ETN_BID_ID",
                "BID_CNT",
                "ETN_BID_STT_NM",
                "BID_END_DT",
                "LAST_CHG_DT",
            )
        }
    ),
)

# eat-v1 상세 파서가 아는 `ds_info` column 13개다. live `ds_info`는 116컬럼이지만 계약은 파서가
# 해석하는 것만 주장한다(`ReviewedSchemaContract` docstring). eat-v2가 같은 목록에 자기 몫을 얹으므로
# 상수로 뽑았다. 이 tuple의 값이 바뀌면 봉인된 v1 발행물의 fingerprint가 달라진다.
_EAT_V1_DETAIL_INFO_COLUMNS = (
    "ELCTRN_BID_NO",
    "BID_NM",
    "ELCTRN_BID_STT_NM",
    "PURR_CD",
    "PURR_NM",
    "SIDO_CD",
    "SIGUNGU_CD",
    "PBANC_YMD",
    "BID_END_DT",
    "OPNG_DT",
    "BGNG_PRC",
    "ELCTRN_BID_PLNPRC",
    "MAIN_ITEMS",
)

_EAT_V1_BID_DETAIL = ReviewedSchemaContract(
    source="eat",
    endpoint="bid-detail",
    parser_version="eat-v1",
    datasets=MappingProxyType(
        {
            "ds_info": _EAT_V1_DETAIL_INFO_COLUMNS,
            "ds_areaList": ("PDLC_CD",),
        }
    ),
    # 파서가 `_required_text`로 읽는 넷이다. 나머지는 모두 nullable 값이라 없어도 canonical 사실을
    # 만들 수 있다. `ds_areaList`는 참가제한지역이 없는 공고가 있으므로 필수가 아니다.
    required=MappingProxyType(
        {
            "ds_info": (
                "BID_NM",
                "ELCTRN_BID_STT_NM",
                "PURR_CD",
                "PURR_NM",
            )
        }
    ),
)

# eat-v2가 아는 명단 column 55개다. 근거는 `docs/evidence/source-boundary/2026-09-03-bid-roster-in-
# detail.md` §3의 실측과 그 응답에서 만든 `tests/fixtures/eat/bid-detail-roster.xml`이다. 파서가 읽지
# 않는 column까지 두는 이유는 소스가 column을 더하거나 뺄 때 원본 대비로 알아채기 위해서다(목록 계약과
# 같은 이유).
_EAT_V2_BID_LIST_COLUMNS = (
    "BEF_JDG_ID", "BID_CALC_AMT", "BID_DT", "BID_END_DT", "BID_NO", "BID_STT", "BID_STT_NM",
    "BID_UNITPRICE", "BIZ_NO", "CHK", "CNTRCT_UNITPRICE_IPT_YN", "DRAW_NO", "EFT_ALL_AMT", "ETC",
    "ETC_YN", "EVL_SCR", "EXCL_RSN", "FRST_REG_DT", "FRST_RGTR_ID", "INSR_SCRITS_NO", "JUDG_SCORE",
    "LAST_CHGR_ID", "LAST_CHG_DT", "NARA_BIZ_NO", "NEGO_SCORE", "NOTIFY_SEQ", "NOTIFY_STATE_CODE",
    "NOTIFY_STATE_NM", "PRPR_YN", "PRPSAL_ATCHFL_ID", "PRPSAL_EVL_STAT_CD", "QLF_ABL_SCORE",
    "QLF_PRC_SCORE", "QLF_RESULT", "QLF_STT", "QLF_STT_NM", "QLF_TOT_SCORE", "RNK", "RNK2", "RNK3",
    "SAJEONG_PCT", "SCORE_TABLE_SEQ", "SGNNG_ID", "SHIPPER_BRNO", "SHIPPER_CD", "SHIPPER_NM",
    "SKILL_SCORE", "SUCBD_DECISION_MTHD", "SUCBD_DT", "TEMPSAVE_YN", "TOTAL_NUM", "USE_YN",
    "WAIVER_CNT", "WITHDRAWAL_YN", "ELCTRN_BID_ID",
)

# 복수예정가격 후보 표의 column 5개다. 같은 evidence 문서 §6의 `ELCTRN_BID_ID=5669410` 관측이다.
_EAT_V2_P_LIST_COLUMNS = (
    "CHC_YN", "CMNM_PLNPRC", "CMNM_PLNPRC_RT", "CMNM_PLNPRC_SN", "ELCTRN_BID_ID",
)

# 재공고 사슬 이력의 column 34개다. 같은 evidence 문서 §7의 `ELCTRN_BID_ID=5306521` 관측이다.
_EAT_V2_BID_HISTORY_COLUMNS = (
    "BID_END_DT", "BID_NM", "BID_NUM_LIMIT_CNT", "BID_NUM_LIMIT_YN", "BID_STRT_DT", "BID_TYPE",
    "BID_TYPE_NM", "DLVRY_END_DT", "DLVRY_PLACE", "DLVRY_STRT_DT", "DLVRY_TIME", "ETC_CN",
    "ETN_BID_ID", "ETN_BID_NO", "ETN_BID_STT", "ETN_BID_STT_NM", "FRST_REG_DT", "FRST_RGTR_ID",
    "LAST_CHGR_ID", "LAST_CHG_DT", "LIMIT_CONDITION", "LIMIT_CONDITION_NM", "PLNPRCE",
    "PLNPRCE_SUCBD_STD", "PLNPRCE_TYPE", "PLNPRCE_TYPE_NM", "PURR_CD", "SOLO_BID_TRT_MTHD",
    "SOLO_BID_TRT_MTHD_NM", "STRPRCE", "STRPRCE_OPEN_YN", "SUCBD_DECISION_MTHD",
    "SUCBD_DECISION_MTHD_NM", "USE_YN",
)

# `ds_info`와 `ds_areaList`는 v1과 같은 원칙으로 파서가 해석하는 column만 적는다(live는 각각 116·8
# 컬럼이다). 새로 들어오는 세 블록은 관측된 전체 모양을 적어 소스의 column 증감을 원본 대비로
# 알아챈다. 두 규모가 다른 것은 실수가 아니라 앞의 둘이 이미 부분 선언이기 때문이다.
_EAT_V2_BID_DETAIL = ReviewedSchemaContract(
    source="eat",
    endpoint="bid-detail",
    parser_version="eat-v2",
    datasets=MappingProxyType(
        {
            "ds_info": (
                *_EAT_V1_DETAIL_INFO_COLUMNS,
                "PLNPRCE_SUCBD_STD",
                "PLNPRC_TYPE_CD",
                "PLNPRCE_TYPE_NM",
                "SUCBID_DCSN_MTH_CD",
                "SUCBD_DECISION_MTHD_NM",
                "BID_CNT",
                "UP_ELCTRN_BID_ID",
                "RBID_YN",
            ),
            "ds_areaList": ("PDLC_CD",),
            "ds_bidList": _EAT_V2_BID_LIST_COLUMNS,
            "ds_pList": _EAT_V2_P_LIST_COLUMNS,
            "ds_bidHistory": _EAT_V2_BID_HISTORY_COLUMNS,
        }
    ),
    # 왜 새 블록을 required에 넣지 않나. fingerprint는 "관측된 required column"으로 계산되므로 명단이
    # 없는 상세(유찰·취소·개찰 전)는 필수 column이 사라져 전부 계약 위반이 된다. 2026-09-04 레이크
    # 무작위 2,000건이 전부 낙찰 공고라 그 모양을 관측한 적이 없으므로 존재를 단언할 근거가 없다.
    # 블록이 있는데 행이 해석되지 않는 경우는 파서가 행 단위로 거부하고 그 관측만 격리한다.
    required=MappingProxyType({"ds_info": ("BID_NM", "ELCTRN_BID_STT_NM", "PURR_CD", "PURR_NM")}),
)

# 목록 응답은 eat-v2에서 달라지지 않지만 실행 단위는 parser version 하나다(`discover_release`의 검사).
# v2 실행이 목록 계약을 못 찾으면 발견 자체가 멈추므로 같은 모양을 v2 이름으로 다시 등록한다.
_EAT_V2_BID_LIST_PAGE = replace(_EAT_V1_BID_LIST, parser_version="eat-v2")

REVIEWED_EAT_SCHEMA_CONTRACTS = MappingProxyType(
    {
        (contract.source, contract.endpoint, contract.parser_version): contract
        for contract in (
            _EAT_V1_BID_LIST,
            _EAT_V1_BID_DETAIL,
            _EAT_V2_BID_LIST_PAGE,
            _EAT_V2_BID_DETAIL,
        )
    }
)


def reviewed_schema_fingerprint(
    *, source: str, endpoint: str, parser_version: str
) -> str | None:
    contract = reviewed_schema_contract(
        source=source,
        endpoint=endpoint,
        parser_version=parser_version,
    )
    return contract.fingerprint if contract is not None else None


def reviewed_schema_contract(
    *, source: str, endpoint: str, parser_version: str
) -> ReviewedSchemaContract | None:
    return REVIEWED_EAT_SCHEMA_CONTRACTS.get((source, endpoint, parser_version))


def validate_eat_schema_contract(
    *,
    source: str,
    endpoint: str,
    parser_version: str,
    schema_fingerprint: str | None,
) -> bool:
    expected = reviewed_schema_fingerprint(
        source=source,
        endpoint=endpoint,
        parser_version=parser_version,
    )
    return expected is not None and schema_fingerprint == expected
