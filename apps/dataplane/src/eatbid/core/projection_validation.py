"""모듈 책임: 투영 값이 core에 닿기 전에 지켜야 할 계약을 순수 함수로 판정한다.

DB가 잡아 주는 제약과 별개로 여기서 먼저 끊는 이유는 둘이다. 제약 위반은 트랜잭션을 통째로 되돌려
어느 행이 문제였는지를 잃고, 명단 좌표와 낙찰 판정처럼 참조 무결성으로 표현하지 않기로 한 불변식은
DB가 아예 보지 못한다(ADR 0033 §4-라).
"""

from __future__ import annotations

import json
import re
from datetime import datetime
from decimal import Decimal

from eatbid.core.models import AuctionProjection, ExternalCodeRef
from eatbid.core.projection_models import (
    ATTEMPT_LINK_RELATIONS,
    AWARDED_STATUS_CODE,
    AttemptLinkProjection,
    AuctionV2Projection,
    AwardProjection,
    CodeObservation,
    SubmissionProjection,
    SupplierAccountProjection,
)
from eatbid.core.repository import ProjectionContractError
from eatbid.source.eat.code_schemes import (
    ATTEMPT_STATUS,
    AUCTION_ITEM_SCHEME,
    AUCTION_LOCATION_SIDO,
    AUCTION_LOCATION_SIGUNGU,
    AWARD_METHOD,
    BID_STATUS,
    BUSINESS_NUMBER,
    ELIGIBILITY_AREA,
    PLANNED_PRICE_TYPE,
    SOLO_BID_METHOD,
    SUPPLIER_ACCOUNT,
    WITHDRAWAL_FLAG,
)

_SHA256 = re.compile(r"[0-9a-f]{64}")
# `core.auction_revision_code_value.role`이 받아들이는 짝이다. 검토되지 않은 scheme이 role을 얻어
# 조용히 관계 테이블에 앉는 것을 막는다.
REVIEWED_CODE_ROLES = {
    AUCTION_LOCATION_SIDO.namespace: "location_sido",
    AUCTION_LOCATION_SIGUNGU.namespace: "location_sigungu",
    ELIGIBILITY_AREA.namespace: "eligibility_area",
    AWARD_METHOD.namespace: "award_method",
    PLANNED_PRICE_TYPE.namespace: "planned_price_method",
    SOLO_BID_METHOD.namespace: "solo_bid_method",
    # 유일하게 우리가 코드를 발급하는 체계다. 한 공고가 원자 여럿을 가지므로 같은 role이 한 revision에
    # 여러 행으로 앉으며, 그 중복은 관계 표의 제약이 막는다.
    AUCTION_ITEM_SCHEME: "item",
}


def canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def validate_projection(projection: AuctionProjection) -> None:
    """공고 한 건의 투영이 core 열에 그대로 들어갈 수 있는 값인지 본다."""
    if not isinstance(projection, AuctionProjection):
        raise ProjectionContractError(
            "projection factory must return AuctionProjection"
        )
    if any(
        isinstance(value, bool) or not isinstance(value, int) or value <= 0
        for value in (projection.normalized_record_id, projection.observation_id)
    ):
        raise ProjectionContractError("projection lineage IDs must be positive")
    required = {
        "source_system": projection.source_system,
        "endpoint": projection.endpoint,
        "parser_version": projection.parser_version,
        "external_bid_id": projection.external_bid_id,
        "organization_code": projection.organization_code,
        "organization_label": projection.organization_label,
        "source_status": projection.source_status,
        "title": projection.title,
        "currency": projection.currency,
    }
    if any(
        not isinstance(value, str) or not value.strip() for value in required.values()
    ):
        raise ProjectionContractError("projection required strings must be non-empty")
    if projection.display_bid_no is not None and not isinstance(
        projection.display_bid_no, str
    ):
        raise ProjectionContractError(
            "projection display bid number must be text or null"
        )
    _require_instants(
        projection.announced_at, projection.deadline_at, projection.opened_at
    )
    _require_amounts(projection.base_amount, projection.planned_amount)
    if projection.floor_rate is not None and not isinstance(
        projection.floor_rate, Decimal
    ):
        raise ProjectionContractError("projection floor rate must be decimal or null")
    for digest in (
        projection.raw_content_sha256,
        projection.normalized_payload_sha256,
    ):
        if not isinstance(digest, str) or _SHA256.fullmatch(digest) is None:
            raise ProjectionContractError("projection hashes must be lowercase SHA-256")
    if not isinstance(projection.source_payload, dict):
        raise ProjectionContractError("projection source payload must be a JSON object")
    try:
        canonical_json(projection.source_payload)
    except (TypeError, ValueError) as error:
        raise ProjectionContractError(
            "projection source payload must be JSON serializable"
        ) from error
    _validate_code_refs(projection)
    if isinstance(projection, AuctionV2Projection):
        validate_v2_projection(projection)


def _validate_code_refs(projection: AuctionProjection) -> None:
    if not isinstance(projection.code_refs, tuple):
        raise ProjectionContractError("projection code references must be a tuple")
    identities: set[tuple[str, str, str]] = set()
    for reference in projection.code_refs:
        if not isinstance(reference, ExternalCodeRef):
            raise ProjectionContractError(
                "projection code references must be ExternalCodeRef values"
            )
        if any(
            not isinstance(value, str) or not value.strip()
            for value in (reference.namespace, reference.code, reference.role)
        ):
            raise ProjectionContractError(
                "projection code reference fields must be non-empty strings"
            )
        if REVIEWED_CODE_ROLES.get(reference.namespace) != reference.role:
            raise ProjectionContractError("projection code reference is not reviewed")
        if reference.label is not None and (
            not isinstance(reference.label, str) or not reference.label.strip()
        ):
            raise ProjectionContractError(
                "projection code reference label must be text or null"
            )
        identity = (reference.namespace, reference.code, reference.role)
        if identity in identities:
            raise ProjectionContractError(
                "projection code references must be deduplicated"
            )
        identities.add(identity)


def validate_v2_projection(projection: AuctionV2Projection) -> None:
    """명단 grain의 불변식을 본다. 낙찰 좌표 검사가 여기 있는 이유는 그 관계를 FK로 두지 않기로
    했기 때문이다(ADR 0033 §4-라)."""
    submissions = projection.roster.submissions
    if not isinstance(submissions, tuple):
        raise ProjectionContractError("projection roster must be a tuple")
    for ordinal, submission in enumerate(submissions):
        _validate_submission(submission, expected_ordinal=ordinal)
    awarded = tuple(
        submission
        for submission in submissions
        if submission.source_status.code == AWARDED_STATUS_CODE
    )
    if len(awarded) > 1:
        raise ProjectionContractError("observed roster carries multiple award rows")
    _validate_award(projection.award, awarded=awarded)
    if not isinstance(projection.attempt_links, tuple):
        raise ProjectionContractError("projection attempt links must be a tuple")
    seen: set[tuple[str, str]] = set()
    for link in projection.attempt_links:
        _validate_attempt_link(link)
        identity = (link.to_external_bid_id, link.relation)
        if identity in seen:
            raise ProjectionContractError("projection attempt links must be unique")
        seen.add(identity)


def _validate_submission(
    submission: SubmissionProjection, *, expected_ordinal: int
) -> None:
    if not isinstance(submission, SubmissionProjection):
        raise ProjectionContractError("projection roster rows must be submissions")
    if submission.roster_ordinal != expected_ordinal:
        raise ProjectionContractError(
            "projection roster ordinals must follow the observed order"
        )
    _require_code(submission.source_status, namespace=BID_STATUS.namespace)
    if submission.withdrawal is not None:
        _require_code(submission.withdrawal, namespace=WITHDRAWAL_FLAG.namespace)
    _validate_supplier(submission.supplier)
    if not isinstance(submission.amount, Decimal):
        raise ProjectionContractError("projection submission amount must be decimal")
    # 사정률 상한을 여기서 두지 않는다. 100을 넘는 관측이 실재하고 그것을 거르면 관측을 우리 판단으로
    # 덮는 것이 된다(AGENTS 3, ADR 0033 §2).
    if not isinstance(submission.bid_rate, Decimal):
        raise ProjectionContractError("projection submission bid rate must be decimal")
    _require_amounts(submission.effective_amount)
    _require_instants(submission.submitted_at)
    if not isinstance(submission.currency, str) or not submission.currency.strip():
        raise ProjectionContractError("projection submission currency is required")
    for count in (submission.rank, submission.observed_roster_size):
        if count is not None and (isinstance(count, bool) or not isinstance(count, int)):
            raise ProjectionContractError("projection submission counts must be integers")
    if not isinstance(submission.draw_numbers, tuple) or any(
        not isinstance(number, str) or not number.strip()
        for number in submission.draw_numbers
    ):
        raise ProjectionContractError("projection draw numbers must be non-empty text")


def _validate_award(
    award: AwardProjection | None, *, awarded: tuple[SubmissionProjection, ...]
) -> None:
    if award is None:
        if awarded:
            raise ProjectionContractError(
                "observed award row has no award decision projection"
            )
        return
    if not isinstance(award, AwardProjection):
        raise ProjectionContractError("projection award must be an AwardProjection")
    if not awarded:
        raise ProjectionContractError("award decision has no observed roster row")
    row = awarded[0]
    if award.awarded_roster_ordinal != row.roster_ordinal:
        raise ProjectionContractError(
            "award decision coordinates a roster row that is not the award row"
        )
    _require_code(award.source_status, namespace=BID_STATUS.namespace)
    if award.source_status.code != AWARDED_STATUS_CODE:
        raise ProjectionContractError("award decision status is not the awarded code")
    _validate_supplier(award.supplier)
    if not isinstance(award.awarded_amount, Decimal) or not isinstance(
        award.awarded_rate, Decimal
    ):
        raise ProjectionContractError("award decision values must be decimal")
    if award.runner_up_rate is not None and not isinstance(
        award.runner_up_rate, Decimal
    ):
        raise ProjectionContractError("runner-up rate must be decimal or null")
    _require_instants(award.awarded_at)


def _validate_attempt_link(link: AttemptLinkProjection) -> None:
    if not isinstance(link, AttemptLinkProjection):
        raise ProjectionContractError("projection attempt links must be links")
    if not isinstance(link.to_external_bid_id, str) or not link.to_external_bid_id:
        raise ProjectionContractError("attempt link target ID must be non-empty text")
    if link.relation not in ATTEMPT_LINK_RELATIONS:
        raise ProjectionContractError("attempt link relation is not reviewed")
    if link.source_status is not None:
        _require_code(link.source_status, namespace=ATTEMPT_STATUS.namespace)
    _require_amounts(link.base_amount, link.planned_amount)
    _require_instants(link.bid_opened_from, link.bid_closed_at)
    has_amount = link.base_amount is not None or link.planned_amount is not None
    if has_amount and not link.currency:
        raise ProjectionContractError("attempt link amounts require a currency")


def _validate_supplier(supplier: SupplierAccountProjection) -> None:
    if not isinstance(supplier, SupplierAccountProjection):
        raise ProjectionContractError("projection supplier must be an account value")
    if not isinstance(supplier.source_system, str) or not supplier.source_system:
        raise ProjectionContractError("supplier source system is required")
    _require_code(supplier.account, namespace=SUPPLIER_ACCOUNT.namespace)
    if supplier.business_number is not None:
        _require_code(supplier.business_number, namespace=BUSINESS_NUMBER.namespace)


def _require_code(observation: CodeObservation, *, namespace: str) -> None:
    if not isinstance(observation, CodeObservation):
        raise ProjectionContractError("projection code must be a CodeObservation")
    if observation.namespace != namespace:
        raise ProjectionContractError(
            f"projection code scheme is not reviewed: {observation.namespace}"
        )
    if not isinstance(observation.code, str) or not observation.code.strip():
        raise ProjectionContractError("projection code must be non-empty text")
    if observation.label is not None and (
        not isinstance(observation.label, str) or not observation.label.strip()
    ):
        raise ProjectionContractError("projection code label must be text or null")


def _require_instants(*values: datetime | None) -> None:
    for value in values:
        if value is not None and (
            not isinstance(value, datetime) or value.utcoffset() is None
        ):
            raise ProjectionContractError(
                "projection timestamps must be timezone-aware or null"
            )


def _require_amounts(*values: Decimal | None) -> None:
    for value in values:
        if value is not None and not isinstance(value, Decimal):
            raise ProjectionContractError("projection amounts must be decimal or null")
