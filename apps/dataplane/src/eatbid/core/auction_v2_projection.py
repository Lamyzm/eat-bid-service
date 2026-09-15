"""모듈 책임: 봉인된 `auction.v2` 발행 구성원 하나를 core 다섯 테이블이 받는 투영 값으로 옮긴다.

v1 빌더(`pipeline/project.py`)와 나눈 이유는 읽는 계약이 다르기 때문이다. v1 record에는 명단·낙찰·
사슬 블록이 아예 없고, 한 함수가 두 계약을 분기로 읽으면 v2 필드를 v1 경로에서 조용히 잃는다.
"""

from __future__ import annotations

import hashlib
import json
from decimal import Decimal

from pydantic import ValidationError

from eatbid.core.auction_items import read_item_label
from eatbid.core.models import ExternalCodeRef
from eatbid.core.projection_models import (
    AWARDED_STATUS_CODE,
    CHAIN_MEMBER_RELATION,
    PARENT_RELATION,
    AttemptLinkProjection,
    AuctionV2Projection,
    AwardProjection,
    CodeObservation,
    RosterProjection,
    SubmissionProjection,
    SupplierAccountProjection,
    bid_rate_decimal,
    instant_datetime,
    money_decimal,
)
from eatbid.core.repository import FrozenPublicationMember, ProjectionContractError
from eatbid.generated.ingestion_v2 import (
    EatbidIngestionAuctionV2,
    NormalizedAttemptLink,
    NormalizedAwardDecision,
    NormalizedBidSubmission,
    NormalizedSupplierAccount,
    SourceCodedValue,
)
from eatbid.source.eat.code_schemes import (
    AUCTION_ITEM_SCHEME,
    AUCTION_LOCATION_SIDO,
    AUCTION_LOCATION_SIGUNGU,
    ELIGIBILITY_AREA,
)
from eatbid.source.eat.normalize import canonical_payload, canonical_record_object

# 통화는 계약 `Money`가 `KRW` 하나로 고정한다. 금액만 옮기고 통화를 잃으면 그 숫자는 해석할 수 없다
# (AGENTS 15).
_CURRENCY = "KRW"


def parse_canonical_normalized_auction_v2(value: bytes) -> EatbidIngestionAuctionV2:
    """봉인된 정규화 바이트를 v2 계약으로 다시 읽고 canonical 여부까지 확인한다."""
    if not isinstance(value, bytes) or not value:
        raise ProjectionContractError(
            "projection normalized payload must be non-empty canonical JSON bytes"
        )
    try:
        decoded = json.loads(value)
        if not isinstance(decoded, dict):
            raise TypeError("normalized payload must be a JSON object")
        record = EatbidIngestionAuctionV2.model_validate_json(value, strict=True)
        if canonical_payload(record) != value:
            raise ValueError("normalized payload is not canonical JSON")
        return record
    except (TypeError, ValueError, ValidationError) as error:
        raise ProjectionContractError(
            "projection normalized payload is invalid"
        ) from error


def build_eat_auction_v2_projection(
    member: FrozenPublicationMember,
) -> AuctionV2Projection:
    """발행 구성원 하나를 v2 투영으로 만든다. manifest 밖의 값은 읽지 않는다."""
    if member.source_system != "eat":
        raise ProjectionContractError("projection source must be eat")
    if member.endpoint != "bid-detail":
        raise ProjectionContractError("projection endpoint must be bid-detail")
    if member.parser_version != member.run_parser_version:
        raise ProjectionContractError("projection parser version differs from run")
    if len(member.raw_content_sha256) != 64 or any(
        character not in "0123456789abcdef" for character in member.raw_content_sha256
    ):
        raise ProjectionContractError("projection raw content hash is invalid")

    try:
        canonical_bytes = json.dumps(
            member.normalized_payload,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    except (TypeError, ValueError) as error:
        raise ProjectionContractError(
            "projection normalized payload is invalid"
        ) from error
    record = parse_canonical_normalized_auction_v2(canonical_bytes)
    if record.identity.external_bid_id != member.source_entity_id:
        raise ProjectionContractError("projection external ID differs from lineage")

    return AuctionV2Projection(
        normalized_record_id=member.normalized_record_id,
        observation_id=member.observation_id,
        source_system=member.source_system,
        endpoint=member.endpoint,
        parser_version=member.parser_version,
        raw_content_sha256=member.raw_content_sha256,
        normalized_payload_sha256=hashlib.sha256(canonical_bytes).hexdigest(),
        external_bid_id=record.identity.external_bid_id,
        display_bid_no=(
            record.identity.display_bid_number.root
            if record.identity.display_bid_number is not None
            else None
        ),
        organization_code=record.buyer.organization_code,
        organization_label=record.buyer.organization_name,
        code_refs=_code_refs(record, source_system=member.source_system),
        source_status=record.identity.status,
        title=record.identity.title,
        announced_at=instant_datetime(record.schedule.announced_at),
        deadline_at=instant_datetime(record.schedule.deadline_at),
        opened_at=instant_datetime(record.schedule.opened_at),
        base_amount=money_decimal(record.pricing.base_amount),
        planned_amount=money_decimal(record.pricing.planned_amount),
        floor_rate=_floor_rate(record),
        currency=_CURRENCY,
        source_payload=canonical_record_object(record),
        roster=_roster(record),
        award=_award(record),
        attempt_links=_attempt_links(record),
    )


def _code_refs(
    record: EatbidIngestionAuctionV2, *, source_system: str
) -> tuple[ExternalCodeRef, ...]:
    eligibility_codes = tuple(code.root for code in record.location.eligibility_codes)
    if len(set(eligibility_codes)) != len(eligibility_codes):
        raise ProjectionContractError("projection has duplicate eligibility codes")
    labels = _eligibility_labels(
        record, eligibility_codes=eligibility_codes, source_system=source_system
    )
    refs: list[ExternalCodeRef] = []
    if record.location.sido_code is not None:
        refs.append(
            ExternalCodeRef(
                namespace=AUCTION_LOCATION_SIDO.namespace,
                code=record.location.sido_code.root,
                role="location_sido",
            )
        )
    if record.location.sigungu_code is not None:
        refs.append(
            ExternalCodeRef(
                namespace=AUCTION_LOCATION_SIGUNGU.namespace,
                code=record.location.sigungu_code.root,
                role="location_sigungu",
            )
        )
    refs.extend(
        ExternalCodeRef(
            namespace=ELIGIBILITY_AREA.namespace,
            code=code,
            role="eligibility_area",
            label=labels.get(code),
        )
        for code in eligibility_codes
    )
    refs.extend(_item_code_refs(record))
    refs.extend(_terms_code_refs(record))
    return tuple(refs)


def _item_code_refs(record: EatbidIngestionAuctionV2) -> tuple[ExternalCodeRef, ...]:
    """품목 라벨 한 문자열을 원자 코드 여러 행으로 읽는다.

    우리 어휘에 없는 낱말은 코드 행을 만들지 않는다. 억지로 붙이면 없던 원자가 생기고, 대신 여기서
    예외를 올리면 원천이 낱말 하나를 늘린 날 수집 전체가 선다. 지역이 이미 같은 판정을 했다 —
    선언 체계로 번역되지 않는 코드는 빈 채로 둔다. 원본 라벨은 normalized record에 그대로 남으므로
    어휘가 늘면 재수집 없이 재투영으로 채워지고, 빠진 수는 mart 빌드가 센다.
    """
    label = record.classification.source_category_label
    reading = read_item_label(None if label is None else label.root)
    return tuple(
        ExternalCodeRef(namespace=AUCTION_ITEM_SCHEME, code=atom, role="item")
        for atom in reading.atoms
    )


def _eligibility_labels(
    record: EatbidIngestionAuctionV2,
    *,
    eligibility_codes: tuple[str, ...],
    source_system: str,
) -> dict[str, str]:
    """`eligibilityAreas`가 실은 라벨을 코드별로 모은다. 키가 없는 payload는 빈 dict다.

    같은 payload가 코드를 두 자리에 싣는 이유는 `eligibilityCodes`가 봉인된 identity 목록이고
    `eligibilityAreas`가 그 뒤에 가산된 관측이기 때문이다(ADR 0038). 두 자리가 어긋나면 어느 쪽이 사실인지
    projector가 고를 수 없으므로 계약 위반으로 끊는다 — 순서까지 같아야 "같은 행의 관측"이 성립한다.
    """
    areas = record.location.eligibility_areas
    if areas is None:
        return {}
    if tuple(area.code for area in areas) != eligibility_codes:
        raise ProjectionContractError(
            "projection eligibility areas differ from eligibility codes"
        )
    for area in areas:
        if (
            area.code_scheme != ELIGIBILITY_AREA.namespace
            or area.source_system != source_system
        ):
            raise ProjectionContractError(
                "projection eligibility area scheme is not reviewed"
            )
    return {
        area.code: area.label.root for area in areas if area.label is not None
    }


def _terms_code_refs(record: EatbidIngestionAuctionV2) -> tuple[ExternalCodeRef, ...]:
    """예정가격 방식·낙찰 방식을 코드 관계로 옮긴다.

    namespace를 상수가 아니라 관측이 실은 `codeScheme` 그대로 쓴다. role만 우리가 붙이므로 소스가
    다른 체계를 보내기 시작하면 `projection_validation`이 그것을 끊는다. 상수로 덮어쓰면 다른 체계의
    코드가 `award_method`라는 이름표를 달고 조용히 앉는다(AGENTS 2·6).
    """
    return tuple(
        ExternalCodeRef(namespace=value.code_scheme, code=value.code, role=role)
        for value, role in (
            (record.terms.planned_price_method, "planned_price_method"),
            (record.terms.award_method, "award_method"),
        )
        if value is not None
    )


def _floor_rate(record: EatbidIngestionAuctionV2) -> Decimal | None:
    """하한율을 exact decimal로 옮긴다. 관측하지 못했으면 `None`이며 실패가 아니다."""
    floor_rate = record.terms.floor_rate
    return Decimal(floor_rate.value) if floor_rate is not None else None


def _roster(record: EatbidIngestionAuctionV2) -> RosterProjection:
    return RosterProjection(
        submissions=tuple(
            _submission(submission, ordinal)
            for ordinal, submission in enumerate(record.roster.submissions)
        )
    )


def _submission(
    submission: NormalizedBidSubmission, ordinal: int
) -> SubmissionProjection:
    return SubmissionProjection(
        roster_ordinal=ordinal,
        supplier=_supplier(submission.supplier_account),
        submitted_at=instant_datetime(submission.submitted_at),
        amount=Decimal(submission.amount.amount),
        effective_amount=money_decimal(submission.effective_amount),
        currency=submission.amount.currency,
        bid_rate=bid_rate_decimal(submission.bid_rate),
        rank=submission.rank.root if submission.rank is not None else None,
        source_status=_code(submission.source_status),
        withdrawal=(
            _code(submission.withdrawal_flag)
            if submission.withdrawal_flag is not None
            else None
        ),
        draw_numbers=tuple(number.root for number in submission.draw_numbers),
        observed_roster_size=(
            submission.observed_roster_size.root
            if submission.observed_roster_size is not None
            else None
        ),
    )


def _award(record: EatbidIngestionAuctionV2) -> AwardProjection | None:
    award = record.award
    if award is None:
        return None
    return AwardProjection(
        awarded_roster_ordinal=_awarded_ordinal(record, award),
        supplier=_supplier(award.supplier_account),
        awarded_at=instant_datetime(award.awarded_at),
        awarded_amount=Decimal(award.awarded_amount.amount),
        currency=award.awarded_amount.currency,
        awarded_rate=bid_rate_decimal(award.awarded_rate),
        runner_up_rate=(
            bid_rate_decimal(award.runner_up_rate)
            if award.runner_up_rate is not None
            else None
        ),
        source_status=_code(award.source_status),
    )


def _awarded_ordinal(
    record: EatbidIngestionAuctionV2, award: NormalizedAwardDecision
) -> int:
    """낙찰 행의 명단 좌표를 관측에서 되찾는다.

    계약이 낙찰 블록에 좌표를 싣지 않기 때문에 여기서 판정 코드로 다시 고른다. 코드가 유일한 판정
    권위이므로 `002` 행이 둘이면 그것은 좌표 문제가 아니라 관측 자체가 계약을 어긴 것이다.
    """
    ordinals = [
        ordinal
        for ordinal, submission in enumerate(record.roster.submissions)
        if submission.source_status.code == AWARDED_STATUS_CODE
    ]
    if len(ordinals) != 1:
        raise ProjectionContractError(
            "award decision requires exactly one awarded roster row"
        )
    ordinal = ordinals[0]
    observed = record.roster.submissions[ordinal].supplier_account.account_code.code
    if observed != award.supplier_account.account_code.code:
        raise ProjectionContractError("award decision supplier differs from roster row")
    return ordinal


def _attempt_links(
    record: EatbidIngestionAuctionV2,
) -> tuple[AttemptLinkProjection, ...]:
    """부모 참조와 사슬 구성원을 관계 종류로 나눠 옮긴다.

    두 관계가 같은 상대를 가리킬 수 있다 — `UP_ELCTRN_BID_ID`가 `ds_bidHistory`에도 있는 경우다.
    그때는 관계가 둘인 것이 관측 사실이므로 하나로 접지 않는다.
    """
    links = [
        _chain_link(link, relation=CHAIN_MEMBER_RELATION)
        for link in record.lineage.links
    ]
    parent = record.lineage.parent_external_bid_id
    if parent is not None:
        links.append(
            AttemptLinkProjection(
                to_external_bid_id=parent.root,
                relation=PARENT_RELATION,
                display_bid_no=None,
                source_status=None,
                bid_opened_from=None,
                bid_closed_at=None,
                base_amount=None,
                planned_amount=None,
                currency=None,
            )
        )
    return tuple(links)


def _chain_link(link: NormalizedAttemptLink, *, relation: str) -> AttemptLinkProjection:
    base_amount = money_decimal(link.base_amount)
    planned_amount = money_decimal(link.planned_amount)
    currency = next(
        (
            money.currency
            for money in (link.base_amount, link.planned_amount)
            if money is not None
        ),
        None,
    )
    return AttemptLinkProjection(
        to_external_bid_id=link.external_bid_id,
        relation=relation,
        display_bid_no=(
            link.display_bid_number.root if link.display_bid_number is not None else None
        ),
        source_status=(
            _code(link.source_status) if link.source_status is not None else None
        ),
        bid_opened_from=instant_datetime(link.bid_opened_from),
        bid_closed_at=instant_datetime(link.bid_closed_at),
        base_amount=base_amount,
        planned_amount=planned_amount,
        currency=currency,
    )


def _supplier(account: NormalizedSupplierAccount) -> SupplierAccountProjection:
    return SupplierAccountProjection(
        source_system=account.source_system,
        account=_code(account.account_code),
        business_number=(
            _code(account.business_number)
            if account.business_number is not None
            else None
        ),
    )


def _code(value: SourceCodedValue) -> CodeObservation:
    return CodeObservation(
        namespace=value.code_scheme,
        code=value.code,
        label=value.label.root if value.label is not None else None,
    )
