"""모듈 책임: eat-v2 발행이 core로 옮기는 명단·낙찰·업체·사슬 투영 값의 모양과 그 값이 계약
경계를 넘을 때 쓰는 단위 변환을 소유한다.

`models.py`가 가진 `AuctionProjection`은 v1과 v2가 함께 쓰는 공고 한 건의 투영이고, 여기 있는
값들은 v2에서만 생기는 명단 grain이라 함께 바뀌지 않는다. 투영 값을 검증하는 규칙은
`projection_validation.py`가 따로 소유한다.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal

from eatbid.core.models import AuctionProjection
from eatbid.generated.ingestion_v1 import InstantText as InstantTextV1
from eatbid.generated.ingestion_v1 import Money as MoneyV1
from eatbid.generated.ingestion_v2 import InstantText as InstantTextV2
from eatbid.generated.ingestion_v2 import Money as MoneyV2
from eatbid.generated.ingestion_v2 import ObservedBidRate

# `core.auction_attempt_link.relation`의 check 제약이 허용하는 값이다. DDL과 projector가 같은 두
# 문자열을 각자 적으면 한쪽만 늘어난 날 발행이 제약 위반으로 끊긴다.
PARENT_RELATION = "parent"
CHAIN_MEMBER_RELATION = "chain_member"
ATTEMPT_LINK_RELATIONS = (PARENT_RELATION, CHAIN_MEMBER_RELATION)

# 소스가 낙찰로 표시한 판정 코드다. `roster.py`의 같은 상수와 값이 같아야 하며, projector는 낙찰 행의
# 좌표가 실제로 이 코드를 가진 명단 행인지 자기 트랜잭션에서 확인한다(ADR 0033 §4-라).
AWARDED_STATUS_CODE = "002"


@dataclass(frozen=True, slots=True)
class CodeObservation:
    """관측된 외부 코드 하나. `namespace`는 `source/eat/code_schemes.py`의 의미 이름이다."""

    namespace: str
    code: str
    label: str | None


@dataclass(frozen=True, slots=True)
class SupplierAccountProjection:
    """참여 업체 계정 하나의 관측. 계정 코드는 정체성이 아니고 party 승격은 writer의 정책이다."""

    source_system: str
    account: CodeObservation
    business_number: CodeObservation | None


@dataclass(frozen=True, slots=True)
class SubmissionProjection:
    """명단 행 하나. `roster_ordinal`은 관측 순서이며 소스가 준 번호가 아니다."""

    roster_ordinal: int
    supplier: SupplierAccountProjection
    submitted_at: datetime | None
    amount: Decimal
    effective_amount: Decimal | None
    currency: str
    bid_rate: Decimal
    rank: int | None
    source_status: CodeObservation
    withdrawal: CodeObservation | None
    draw_numbers: tuple[str, ...]
    observed_roster_size: int | None


@dataclass(frozen=True, slots=True)
class RosterProjection:
    submissions: tuple[SubmissionProjection, ...]


@dataclass(frozen=True, slots=True)
class AwardProjection:
    """revision 하나의 낙찰 판정. `awarded_roster_ordinal`은 명단 좌표이지 FK가 아니다."""

    awarded_roster_ordinal: int
    supplier: SupplierAccountProjection
    awarded_at: datetime | None
    awarded_amount: Decimal
    currency: str
    awarded_rate: Decimal
    runner_up_rate: Decimal | None
    source_status: CodeObservation


@dataclass(frozen=True, slots=True)
class AttemptLinkProjection:
    """재입찰 사슬 관계 하나. 상대는 외부 문자열로 받아 writer가 내부 attempt id로 바꾼다."""

    to_external_bid_id: str
    relation: str
    display_bid_no: str | None
    source_status: CodeObservation | None
    bid_opened_from: datetime | None
    bid_closed_at: datetime | None
    base_amount: Decimal | None
    planned_amount: Decimal | None
    currency: str | None


@dataclass(frozen=True, slots=True)
class AuctionV2Projection(AuctionProjection):
    """v1 투영에 명단·낙찰·사슬을 더한 것이다.

    왜 상속인가. 발행 잠금과 지문 검증(`postgres_repository`)은 record type과 무관하게 공고 한 건의
    lineage 필드만 본다. 별도 타입으로 감싸면 그 경로가 두 모양을 각각 알아야 하고, 그때부터
    "v1이면 이쪽 v2면 저쪽"이라는 분기가 발행 잠금에까지 번진다.
    """

    roster: RosterProjection
    award: AwardProjection | None
    attempt_links: tuple[AttemptLinkProjection, ...]


@dataclass(frozen=True, slots=True)
class AppliedProjectionCounts:
    """행 하나를 새로 넣었는지 이미 있던 것을 확인했는지의 누계.

    발행이 멱등이라는 주장을 재실행 결과로 확인하려면 "몇 개를 새로 넣었나"가 실행 사실로 남아야 한다.
    """

    auction_attempts: int = 0
    auction_revisions: int = 0
    organizations: int = 0
    code_values: int = 0
    code_labels: int = 0
    relationships: int = 0
    supplier_parties: int = 0
    supplier_accounts: int = 0
    bid_submissions: int = 0
    award_decisions: int = 0
    attempt_links: int = 0

    def __add__(self, other: AppliedProjectionCounts) -> AppliedProjectionCounts:
        return AppliedProjectionCounts(
            auction_attempts=self.auction_attempts + other.auction_attempts,
            auction_revisions=self.auction_revisions + other.auction_revisions,
            organizations=self.organizations + other.organizations,
            code_values=self.code_values + other.code_values,
            code_labels=self.code_labels + other.code_labels,
            relationships=self.relationships + other.relationships,
            supplier_parties=self.supplier_parties + other.supplier_parties,
            supplier_accounts=self.supplier_accounts + other.supplier_accounts,
            bid_submissions=self.bid_submissions + other.bid_submissions,
            award_decisions=self.award_decisions + other.award_decisions,
            attempt_links=self.attempt_links + other.attempt_links,
        )


def instant_datetime(value: InstantTextV1 | InstantTextV2 | None) -> datetime | None:
    """canonical UTC instant 문자열을 tz-aware `datetime`으로 바꾼다. 없으면 `None`이다."""
    return datetime.fromisoformat(value.root) if value is not None else None


def money_decimal(value: MoneyV1 | MoneyV2 | None) -> Decimal | None:
    """금액 문자열을 exact decimal로 바꾼다. 통화는 호출부가 함께 옮긴다(AGENTS 15)."""
    return Decimal(value.amount) if value is not None else None


def observed_planned_amount(value: MoneyV1 | MoneyV2 | None) -> Decimal | None:
    """예정가격 `0`은 금액이 아니라 "추첨된 적 없음"이다.

    eaT는 추첨 전 공고의 `ELCTRN_BID_PLNPRC`를 빈 값이 아니라 `0`으로 보내고, 개찰이 지나도 명단이 없으면
    끝내 `0`이다(2026-09-17 복원본 전수: 0인 회차 14,506건 전부 낙찰·명단 없음, EAT-74·EAT-199). 관측은
    raw·normalized·`source_payload`가 보존하고 core 열은 해석이라 null로 앉힌다(AGENTS 3). 0을 값으로 두면
    `is not null`로 거르는 조회가 그것을 금액으로 센다.
    """
    amount = money_decimal(value)
    return None if amount is not None and amount == 0 else amount


def bid_rate_decimal(value: ObservedBidRate) -> Decimal:
    """사정률은 percentage-point이고 상한이 없다. `numeric(15,3)`이 받는 값 그대로 옮긴다."""
    return Decimal(value.value)


def comparable_row(values: Sequence[object]) -> tuple[object, ...]:
    """투영 값과 저장된 행을 값으로 견주기 위해 모양을 맞춘다.

    `numeric`은 열의 자릿수를 붙여 돌아오고 `text[]`는 list로 온다. 그 차이를 값의 차이로 읽으면
    멱등한 재발행이 계약 위반으로 끊긴다.
    """
    return tuple(
        value.normalize()
        if isinstance(value, Decimal)
        else tuple(value)
        if isinstance(value, list)
        else value
        for value in values
    )
