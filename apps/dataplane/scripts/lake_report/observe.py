"""모듈 책임: 원본 레이크 파일 하나를 원본 사실과 eat-v2 계약 결과 두 경로로 읽어 프로세스 사이를
오갈 수 있는 관측 record로 만든다.

왜 두 경로인가. 계약 상한이 틀리면 그 상한에 걸린 관측은 정규화 결과에서 사라진다. 상한을 검증하려고
만든 리포트가 상한에 걸린 값을 못 보면 목적을 잃으므로, 구조 사실과 최대값은 원본 파싱에서,
정규화 성패와 격리 사유는 `normalize_bid_detail_payload`에서 읽는다. 그 대가로 파일 하나마다 XML을
두 번 파싱한다 — 23만 건 실행에서 파싱 비용이 2배이며, 리포트가 격리된 값을 볼 수 있는 것과 맞바꾼
비용이다.
"""

from __future__ import annotations

import gzip
import json
from collections import Counter
from collections.abc import Mapping
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from pathlib import Path

from eatbid.generated.ingestion_v2 import EatbidIngestionAuctionV2
from eatbid.source.eat.lineage import BID_HISTORY_DATASET
from eatbid.source.eat.normalize import normalize_bid_detail_payload
from eatbid.source.eat.reserve_price import P_LIST_DATASET
from eatbid.source.eat.roster import AWARDED_STATUS_CODE, BID_LIST_DATASET
from eatbid.source.eat.xml import ParsedNexacro, parse_nexacro

PARSER_VERSION = "eat-v2"
REPOSITORY_ROOT = Path(__file__).resolve().parents[4]
CONTRACT_SCHEMA = (
    REPOSITORY_ROOT / "packages" / "contracts" / "generated" / "ingestion-v2.schema.json"
)
# 사정률 상한은 계약 atom `ObservedBidRateText`가 정규식(정수부 12자리)으로 표현해 maxItems처럼
# 읽어낼 수 없다. 규칙이 바뀌면 이 값도 같이 틀려야 리포트가 거짓말을 하지 않으므로 근거 경로를 함께
# 적어둔다. 공개 API의 `BidRateText`(0~100)는 이 리포트가 세는 관측과 다른 계약이다.
OBSERVED_BID_RATE_CEILING = Decimal("999999999999.999")
# BID_CALC_AMT가 이 값을 넘으면 금액이 아니라 소스가 가린 자리표시자다(1조 원). 실측에서 14자리
# 1e13대 값만 나타났고 같은 공고 안에서 EFT_ALL_AMT와 상보 관계를 지킨다.
MASKED_AMOUNT_FLOOR = Decimal(1_000_000_000_000)
# `auction_terms.py`가 읽는 이름과 레이크에 실제로 있는 이름을 함께 본다. 어느 쪽이 관측되는지가
# 낙찰 방식 코드의 존재 여부를 가르는 사실이므로 리포트가 column 이름까지 세어 남긴다.
AWARD_METHOD_FIELDS = ("SUCBID_DCSN_MTH_CD", "SUCBD_DECISION_MTHD")
# 관측 하나가 실패해도 실행은 계속되어야 한다(AGENTS 3). `Decimal("nan") > Decimal("1")`처럼
# 원본이 유한하지 않은 값을 보내면 `InvalidOperation`이 오르는데 그것은 `ArithmeticError`라
# `ValueError` 계열에 걸리지 않는다. 이 목록에 없는 예외만 실행 전체를 멈춘다.
_OBSERVATION_ERRORS = (
    OSError,
    EOFError,
    ValueError,
    KeyError,
    IndexError,
    ArithmeticError,
)
# 계약 위반 문장은 상한 숫자를 끝에 달고 온다("... at most 999999999999.999 at scale 3"). 80자에서
# 자르면 그 숫자가 중간에서 끊겨 독자가 잘린 값을 상한으로 읽는다. 160자면 관측된 사유가 다 들어가고,
# 그래도 넘치면 잘렸다는 것을 `…`로 알린다.
_MAX_REASON_LENGTH = 160
_TRUNCATION_MARK = "…"


@dataclass(frozen=True, slots=True)
class RoundSummary:
    """남산초 대조가 쓰는 회차 요약. 업체 정체성은 담지 않는다."""

    external_bid_id: str
    award_rate: str | None
    roster_size: int


@dataclass(frozen=True, slots=True)
class FileObservation:
    """파일 하나의 관측. 프로세스 사이를 오가므로 원시 문자열·정수만 담는다."""

    external_bid_id: str
    normalized: bool
    quarantine_reason: str | None = None
    organization_code: str | None = None
    opened_on: str | None = None
    has_bid_list: bool = False
    has_p_list: bool = False
    has_bid_history: bool = False
    roster_rows: int = 0
    draw_candidates: int = 0
    chain_links: int = 0
    max_draw_numbers: int = 0
    max_bid_rate: str | None = None
    bid_status_counts: tuple[tuple[str, int], ...] = ()
    award_method_code: str | None = None
    award_method_field: str | None = None
    masked_amount_rows: int = 0
    masked_withdrawn_rows: int = 0
    award_rows: int = 0
    # 명단 행 가운데 `BIZ_NO`를 관측하지 못한 행 수다. 업체 정체성 승격 규칙(사업자번호가 없으면
    # 계정마다 별도 party)이 실제로 몇 행에 적용되는지가 이 수다.
    business_number_missing_rows: int = 0
    # 정규화 결과의 `schedule.openedAt`이 없는가. 원본 `OPNG_DT` 유무(`opened_on`)와 달리 계약을
    # 통과한 뒤의 사실이며, `core.bid_submission`의 파티션 키 결측이 바로 이 값이다.
    opened_at_missing: bool = False
    award_rate: str | None = None
    runner_up_gap: str | None = None
    floor_rate: str | None = None
    below_floor_rows: int = 0
    award_below_floor: bool = False
    draw_average_mismatch: bool = False
    draw_average_checked: bool = False


def contract_bounds() -> dict[str, int]:
    """계약이 선언한 상한을 생성된 JSON Schema에서 직접 읽는다.

    리포트가 비교 기준을 스스로 읽어 오면 계약이 바뀐 날 문서만 옛 숫자를 들고 남는 일이 없다.
    """
    definitions = json.loads(CONTRACT_SCHEMA.read_text(encoding="utf-8"))["$defs"]

    def max_items(name: str, prop: str) -> int:
        return int(definitions[name]["properties"][prop]["maxItems"])

    return {
        "roster_rows": max_items("NormalizedBidRoster", "submissions"),
        "draw_candidates": max_items("NormalizedReservePriceDraw", "candidates"),
        "chain_links": max_items("NormalizedAuctionLineage", "links"),
        "max_draw_numbers": max_items("NormalizedBidSubmission", "drawNumbers"),
    }


def lake_files(lake: Path) -> list[Path]:
    return sorted(lake.glob("*/*.xml.gz"))


def locate(lake: Path, external_bid_id: str) -> Path | None:
    """공고 하나의 파일을 찾는다. shard 이름 규칙을 가정하지 않고 shard 전체를 훑는다."""
    matches = sorted(lake.glob(f"*/{external_bid_id}.xml.gz"))
    return matches[0] if matches else None


def decimal_or_none(text: str | None) -> Decimal | None:
    """숫자로 읽을 수 없거나 유한하지 않은 값은 `None`이다.

    `nan`·`Infinity`는 `Decimal`이 받아들이지만 비교 연산에서 `InvalidOperation`을 올린다. 그런
    값을 그대로 흘려보내면 관측 하나가 실행 전체를 멈추므로 여기서 없는 값으로 만든다.
    """
    if not text:
        return None
    try:
        value = Decimal(text)
    except InvalidOperation:
        return None
    return value if value.is_finite() else None


def quarantine_reason(error: BaseException) -> str:
    """격리 사유를 표 한 칸에 들어가는 한 줄로 만든다.

    Pydantic `ValidationError`의 문자열은 여러 줄이고 `input_value=`를 담는다. 개행이 그대로
    실리면 증거 문서의 Markdown 표가 깨지고, 파이프 문자는 열을 갈라버린다. 절단은 원본 값이
    문서로 새어나가는 폭까지 함께 줄인다.
    """
    detail = " ".join(str(error).split())
    if len(detail) > _MAX_REASON_LENGTH:
        detail = detail[:_MAX_REASON_LENGTH] + _TRUNCATION_MARK
    return f"{type(error).__name__}: {detail}".replace("|", "\\|")


def observe_file(path_text: str) -> FileObservation:
    """파일 하나를 원본 사실과 계약 결과 두 경로로 읽는다. 프로세스 풀의 작업 단위다."""
    path = Path(path_text)
    external_bid_id = path.name.split(".", 1)[0]
    try:
        payload = gzip.decompress(path.read_bytes())
        parsed = parse_nexacro(payload, require_ds_info=True)
        # 원본 사실 계산도 같은 try 안이다. 밖에 두면 원본 값 하나 때문에 오른 예외가 23만 건짜리
        # 실행을 통째로 끝내고, 그것은 관측 하나만 격리한다는 전제를 깬다.
        raw = _raw_facts(parsed)
    except _OBSERVATION_ERRORS as error:
        return FileObservation(
            external_bid_id=external_bid_id,
            normalized=False,
            quarantine_reason=quarantine_reason(error),
        )
    try:
        record = normalize_bid_detail_payload(
            payload, external_bid_id=external_bid_id, parser_version=PARSER_VERSION
        ).record
    except (*_OBSERVATION_ERRORS, RuntimeError) as error:
        return FileObservation(
            external_bid_id=external_bid_id,
            normalized=False,
            quarantine_reason=quarantine_reason(error),
            **raw,  # type: ignore[arg-type]
        )
    return FileObservation(
        external_bid_id=external_bid_id,
        normalized=True,
        **raw,  # type: ignore[arg-type]
        **_derived_facts(record),  # type: ignore[arg-type]
    )


def _raw_facts(parsed: ParsedNexacro) -> dict[str, object]:
    """계약 상한과 무관하게 원본이 실제로 담은 구조 사실을 센다."""
    info = parsed.datasets["ds_info"][0]
    roster_rows = parsed.datasets.get(BID_LIST_DATASET, ())
    statuses: Counter[str] = Counter()
    max_bid_rate: Decimal | None = None
    max_draw_numbers = 0
    masked = 0
    masked_withdrawn = 0
    business_number_missing = 0
    for row in roster_rows:
        statuses[row.get("BID_STT", "")] += 1
        if not (row.get("BIZ_NO") or "").strip():
            business_number_missing += 1
        observed = decimal_or_none(row.get("SAJEONG_PCT"))
        if observed is not None and (max_bid_rate is None or observed > max_bid_rate):
            max_bid_rate = observed
        drawn = row.get("DRAW_NO") or ""
        if drawn:
            max_draw_numbers = max(max_draw_numbers, len(drawn.split(",")))
        calculated = decimal_or_none(row.get("BID_CALC_AMT"))
        if calculated is not None and calculated > MASKED_AMOUNT_FLOOR:
            masked += 1
            if row.get("WITHDRAWAL_YN") == "Y":
                masked_withdrawn += 1
    method_field = next((name for name in AWARD_METHOD_FIELDS if name in info), None)
    opened = info.get("OPNG_DT") or ""
    checked, mismatch = draw_average(parsed, info)
    return {
        "organization_code": info.get("PURR_CD") or None,
        "opened_on": (
            f"{opened[:4]}-{opened[4:6]}-{opened[6:8]}" if len(opened) >= 8 else None
        ),
        "has_bid_list": BID_LIST_DATASET in parsed.datasets,
        "has_p_list": P_LIST_DATASET in parsed.datasets,
        "has_bid_history": BID_HISTORY_DATASET in parsed.datasets,
        "roster_rows": len(roster_rows),
        "draw_candidates": len(parsed.datasets.get(P_LIST_DATASET, ())),
        "chain_links": len(parsed.datasets.get(BID_HISTORY_DATASET, ())),
        "max_draw_numbers": max_draw_numbers,
        "max_bid_rate": str(max_bid_rate) if max_bid_rate is not None else None,
        "bid_status_counts": tuple(sorted(statuses.items())),
        "award_method_code": info.get(method_field) if method_field else None,
        "award_method_field": method_field,
        "masked_amount_rows": masked,
        "masked_withdrawn_rows": masked_withdrawn,
        "award_rows": statuses[AWARDED_STATUS_CODE],
        "business_number_missing_rows": business_number_missing,
        "draw_average_checked": checked,
        "draw_average_mismatch": mismatch,
    }


def draw_average(parsed: ParsedNexacro, info: Mapping[str, str]) -> tuple[bool, bool]:
    """선택된 추첨 후보의 평균이 예정가격이 되는지 원본 값으로 확인한다.

    왜 정규화 결과가 아니라 원본인가. 소스는 평균을 `ELCTRN_BID_PLNPRC`가 실제로 쓴 자릿수까지
    반올림한다 — 정수로 오는 회차는 .50을 올리고 소수 둘째 자리로 오는 회차는 셋째 자리를 올린다.
    계약 `Money`는 자릿수를 2로 맞추므로 그 정보가 사라지고 정상 회차가 위반으로 잡힌다.
    """
    planned = decimal_or_none(info.get("ELCTRN_BID_PLNPRC"))
    chosen = [
        value
        for value in (
            decimal_or_none(row.get("CMNM_PLNPRC"))
            for row in parsed.datasets.get(P_LIST_DATASET, ())
            if row.get("CHC_YN") == "Y"
        )
        if value is not None
    ]
    if planned is None or not chosen:
        return False, False
    mean = sum(chosen, Decimal(0)) / Decimal(len(chosen))
    return True, mean.quantize(planned, ROUND_HALF_UP) != planned


def _derived_facts(record: EatbidIngestionAuctionV2) -> dict[str, object]:
    """정규화 성공분에서만 계산하는 파생 지표. 소스에는 이 판정이 없다(AGENTS 3·8).

    하한 미만과 1·2등 격차는 리포트가 관측값에서 다시 세는 값이지 정규화 모델의 필드가 아니다.
    비율의 분모는 명단 행 수다 — 계약이 명단 행마다 사정률을 요구하므로(`roster.py`) 사정률이 있는
    행은 곧 명단 행이며, 취소(`WITHDRAWAL_YN=Y`) 행도 포함된다.
    """
    terms = record.terms
    award = record.award
    floor = (
        decimal_or_none(terms.floor_rate.value) if terms.floor_rate is not None else None
    )
    scored = [
        value
        for value in (
            decimal_or_none(item.bid_rate.value) for item in record.roster.submissions
        )
        if value is not None
    ]
    below = [value for value in scored if floor is not None and value < floor]
    valid = sorted(value for value in scored if floor is None or value >= floor)
    gap = valid[1] - valid[0] if len(valid) >= 2 else None
    award_rate = (
        award.awarded_rate.value
        if award is not None and award.awarded_rate is not None
        else None
    )
    awarded = decimal_or_none(award_rate)
    return {
        "award_rate": award_rate,
        "opened_at_missing": record.schedule.opened_at is None,
        "runner_up_gap": str(gap) if gap is not None else None,
        "floor_rate": terms.floor_rate.value if terms.floor_rate is not None else None,
        "below_floor_rows": len(below),
        "award_below_floor": (
            awarded is not None and floor is not None and awarded < floor
        ),
    }


