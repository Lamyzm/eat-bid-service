"""eat-v2 발행이 명단·낙찰·업체·사슬을 core에 남기는지 실제 PostgreSQL에서 확인한다.

`test_project.py`와 나눈 이유는 검증 대상이 다르기 때문이다. 그쪽은 발행 잠금·지문·동시성이고
여기는 명단 grain의 행이 실제로 어떻게 앉는지다. 두 파일이 같은 harness를 쓰지만 함께 바뀌지 않는다.
"""

from __future__ import annotations

import re
from decimal import Decimal
from pathlib import Path
from uuid import UUID, uuid4

import pytest

from eatbid.core.repository import ProjectionContractError
from eatbid.pipeline.project import project_publication
from eatbid.pipeline.validate import validate_run

from .conftest import PipelineServices
from .test_normalize_validate import (
    BUILD_SHA,
    VALIDATED_AT,
    capture_detail,
    normalize_one,
    start_run,
)
from .test_project import ACTIVATED_AT

ROSTER_FIXTURE = (
    Path(__file__).parents[1] / "fixtures" / "eat" / "bid-detail-roster.xml"
)
REBID_FIXTURE = Path(__file__).parents[1] / "fixtures" / "eat" / "bid-detail-rebid.xml"
PARSER_VERSION = "eat-v2"
# 원본의 `ds_bidList` 행과 낙찰 행 사정률을 직접 읽는다. 기대값을 손으로 적으면 파서가 그 행들을
# 잘못 세도 대조가 통과한다.
_ROW = re.compile(rb"<Row>.*?</Row>", re.DOTALL)
_BID_RATE = re.compile(rb'<Col id="SAJEONG_PCT">([0-9.]+)</Col>')
_AWARDED_STATUS = re.compile(rb'<Col id="BID_STT">002</Col>')
# 공고 조건도 같은 이유로 원본에서 직접 읽는다. 기대값을 손으로 적으면 파서가 다른 column을 읽어도
# 대조가 통과한다.
_FLOOR_RATE = re.compile(rb'<Col id="PLNPRCE_SUCBD_STD">([0-9.]+)</Col>')
_AWARD_METHOD = re.compile(rb'<Col id="SUCBID_DCSN_MTH_CD">([^<]+)</Col>')
_PLANNED_PRICE_TYPE = re.compile(rb'<Col id="PLNPRC_TYPE_CD">([^<]+)</Col>')


def _roster_rows(body: bytes) -> list[bytes]:
    """명단 행만 고른다. 계약이 명단 행마다 `SAJEONG_PCT`를 요구하므로 그것이 있는 행이 명단이다."""
    return [row for row in _ROW.findall(body) if _BID_RATE.search(row) is not None]


def source_roster_size(body: bytes) -> int:
    return len(_roster_rows(body))


def source_awarded_rate(body: bytes) -> Decimal:
    """판정 코드가 `002`인 행의 사정률. 행 안에서 찾으므로 낙찰 행의 위치에 기대지 않는다."""
    awarded = [row for row in _roster_rows(body) if _AWARDED_STATUS.search(row)]
    assert len(awarded) == 1, "원본의 낙찰 행은 하나여야 한다"
    match = _BID_RATE.search(awarded[0])
    assert match is not None
    return Decimal(match.group(1).decode())


def publish_v2_observation(
    services: PipelineServices, body: bytes, *, external_bid_id: str | None = None
) -> tuple[UUID, str]:
    """eat-v2 계약으로 관측 하나를 잡아 정규화하고 발행 manifest까지 봉인한다."""
    external_bid_id = external_bid_id or uuid4().hex
    run_id = start_run(services, parser_version=PARSER_VERSION)
    observation_id = capture_detail(
        services,
        run_id=run_id,
        external_bid_id=external_bid_id,
        body=body,
    )
    normalized = normalize_one(
        services, observation_id, parser_version=PARSER_VERSION
    )
    assert normalized.record_type == "auction.v2"
    publication_id = uuid4()
    validation = validate_run(
        run_id=normalized.run_id,
        publication_id=publication_id,
        validated_at=VALIDATED_AT,
        repository=services.publication_repository,
    )
    assert validation.status == "validated"
    return publication_id, external_bid_id


def validated_v2_publication(
    services: PipelineServices, *, fixture: Path = ROSTER_FIXTURE
) -> tuple[UUID, str]:
    return publish_v2_observation(services, fixture.read_bytes())


def _source_group(pattern: re.Pattern[bytes], body: bytes) -> str:
    match = pattern.search(body)
    assert match is not None, "원본에 그 조건 column이 있어야 한다"
    return match.group(1).decode()


ROSTER_ROWS = source_roster_size(ROSTER_FIXTURE.read_bytes())
AWARDED_RATE = source_awarded_rate(ROSTER_FIXTURE.read_bytes())
SOURCE_FLOOR_RATE = Decimal(_source_group(_FLOOR_RATE, ROSTER_FIXTURE.read_bytes()))
SOURCE_AWARD_METHOD = _source_group(_AWARD_METHOD, ROSTER_FIXTURE.read_bytes())
SOURCE_PLANNED_PRICE_TYPE = _source_group(
    _PLANNED_PRICE_TYPE, ROSTER_FIXTURE.read_bytes()
)


def roster_rows(services: PipelineServices, external_bid_id: str) -> list[tuple]:
    with services.connection.cursor() as cursor:
        cursor.execute(
            """
            select s.roster_ordinal, s.bid_rate, s.amount, s.currency, v.code,
                   s.opened_at, s.supplier_party_id, s.draw_numbers
            from core.bid_submission s
            join core.auction_attempt a using (auction_attempt_id)
            join core.code_value v on v.code_value_id = s.source_status_code_value_id
            where a.external_bid_id = %s
            order by s.roster_ordinal
            """,
            (external_bid_id,),
        )
        return cursor.fetchall()


def test_eat_v2_발행은_명단과_낙찰을_한_트랜잭션에_남긴다(
    pipeline_services: PipelineServices,
) -> None:
    publication_id, external_bid_id = validated_v2_publication(pipeline_services)

    result = project_publication(
        publication_id=publication_id,
        projector_version=BUILD_SHA,
        activated_at=ACTIVATED_AT,
        repository=pipeline_services.projection_repository,
    )

    assert result.bid_submissions_inserted == ROSTER_ROWS
    assert result.award_decisions_inserted == 1
    rows = roster_rows(pipeline_services, external_bid_id)
    assert [row[0] for row in rows] == list(range(ROSTER_ROWS))
    assert rows[0][1] == AWARDED_RATE
    assert rows[0][3] == "KRW"
    assert rows[0][4] == "002"
    assert rows[0][7] == ["7", "3"]
    # 개찰 시각이 명단 행마다 복사되어 파티션 키가 된다.
    assert {row[5] for row in rows} == {rows[0][5]}
    assert rows[0][5] is not None

    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            """
            select d.awarded_roster_ordinal, d.awarded_rate, d.runner_up_rate,
                   v.code, d.supplier_party_id
            from core.award_decision d
            join core.auction_attempt a using (auction_attempt_id)
            join core.code_value v on v.code_value_id = d.source_status_code_value_id
            where a.external_bid_id = %s
            """,
            (external_bid_id,),
        )
        award = cursor.fetchone()
    assert award is not None
    assert award[0] == 0
    assert award[1] == AWARDED_RATE
    assert award[2] == Decimal("90.382")
    assert award[3] == "002"
    assert award[4] == rows[0][6]


def test_eat_v2_발행은_공고_조건을_열과_코드_관계로_남긴다(
    pipeline_services: PipelineServices,
) -> None:
    """하한율·낙찰 방식·예정가격 방식이 jsonb 밖의 조회 가능한 사실이 되는지 본다(ADR 0033 §4-가)."""
    publication_id, external_bid_id = validated_v2_publication(pipeline_services)

    project_publication(
        publication_id=publication_id,
        projector_version=BUILD_SHA,
        activated_at=ACTIVATED_AT,
        repository=pipeline_services.projection_repository,
    )

    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            """
            select ar.floor_rate
            from core.auction_revision ar
            join core.auction_attempt aa using (auction_attempt_id)
            where aa.external_bid_id = %s
            """,
            (external_bid_id,),
        )
        revision = cursor.fetchone()
        cursor.execute(
            """
            select rcv.role, cs.namespace, cv.code
            from core.auction_revision_code_value rcv
            join core.auction_revision ar using (auction_revision_id)
            join core.auction_attempt aa using (auction_attempt_id)
            join core.code_value cv on cv.code_value_id = rcv.code_value_id
            join core.code_scheme cs using (code_scheme_id)
            where aa.external_bid_id = %s
              and rcv.role in ('award_method', 'planned_price_method')
            order by rcv.role
            """,
            (external_bid_id,),
        )
        terms = cursor.fetchall()

    assert revision is not None
    assert revision[0] == SOURCE_FLOOR_RATE
    assert terms == [
        ("award_method", "eat:award-method", SOURCE_AWARD_METHOD),
        ("planned_price_method", "eat:planned-price-type", SOURCE_PLANNED_PRICE_TYPE),
    ]


def test_사업자번호가_없으면_계정마다_별도_업체를_만든다(
    pipeline_services: PipelineServices,
) -> None:
    """사업자번호를 관측하지 못한 명단은 계정마다 자기 party를 갖는다(ADR 0033 §1).

    fixture의 `BIZ_NO` 값을 비운 원본으로 발행해 승격 규칙이 실제 행으로 나타나는지 본다. column을
    지우지 않고 값만 비우는 이유는 검토된 schema 계약이 선언되지 않은 column을 격리시키기 때문이며,
    실제 소스도 값을 보내지 않을 뿐 column은 보낸다.
    """
    body = re.sub(
        rb'<Col id="BIZ_NO">[^<]*</Col>',
        b'<Col id="BIZ_NO"></Col>',
        ROSTER_FIXTURE.read_bytes(),
    )
    # 계정 code value는 발행을 가로질러 유일하다. 다른 검증이 이미 승격해 둔 계정을 다시 쓰면
    # "사업자번호 없는 새 계정"이라는 이 검증의 전제가 성립하지 않는다.
    body = re.sub(
        rb'<Col id="SHIPPER_CD">(\d+)</Col>',
        rb'<Col id="SHIPPER_CD">9\1</Col>',
        body,
    )
    external_bid_id = uuid4().hex
    run_id = start_run(pipeline_services, parser_version=PARSER_VERSION)
    observation_id = capture_detail(
        pipeline_services,
        run_id=run_id,
        external_bid_id=external_bid_id,
        body=body,
    )
    normalized = normalize_one(
        pipeline_services, observation_id, parser_version=PARSER_VERSION
    )
    publication_id = uuid4()
    assert (
        validate_run(
            run_id=normalized.run_id,
            publication_id=publication_id,
            validated_at=VALIDATED_AT,
            repository=pipeline_services.publication_repository,
        ).status
        == "validated"
    )

    result = project_publication(
        publication_id=publication_id,
        projector_version=BUILD_SHA,
        activated_at=ACTIVATED_AT,
        repository=pipeline_services.projection_repository,
    )

    assert result.supplier_parties_inserted == ROSTER_ROWS
    rows = roster_rows(pipeline_services, external_bid_id)
    assert len({row[6] for row in rows}) == ROSTER_ROWS
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            """
            select count(*) from core.supplier_party p
            join core.source_supplier_account a using (supplier_party_id)
            join core.bid_submission s
              on s.source_supplier_account_id = a.source_supplier_account_id
            join core.auction_attempt t using (auction_attempt_id)
            where t.external_bid_id = %s and p.business_number_code_value_id is not null
            """,
            (external_bid_id,),
        )
        assert cursor.fetchone()[0] == 0


def test_이미_발행된_publication을_다시_투영하면_행이_늘지_않는다(
    pipeline_services: PipelineServices,
) -> None:
    publication_id, external_bid_id = validated_v2_publication(pipeline_services)
    first = project_publication(
        publication_id=publication_id,
        projector_version=BUILD_SHA,
        activated_at=ACTIVATED_AT,
        repository=pipeline_services.projection_repository,
    )

    second = project_publication(
        publication_id=publication_id,
        projector_version=BUILD_SHA,
        activated_at=ACTIVATED_AT,
        repository=pipeline_services.projection_repository,
    )

    assert first.canonical_fingerprint == second.canonical_fingerprint
    assert second.bid_submissions_inserted == 0
    assert second.award_decisions_inserted == 0
    assert second.supplier_parties_inserted == 0
    assert len(roster_rows(pipeline_services, external_bid_id)) == ROSTER_ROWS


def test_실패한_발행은_명단_행을_남기지_않는다(
    pipeline_services: PipelineServices,
) -> None:
    """투영 도중 계약 위반이 나면 명단이 부분적으로 남지 않는다.

    등록된 `eat:withdrawal-flag` scheme의 이름을 바꿔 코드 해소를 실패시킨다. 첫 명단 행은 이미 쓰인
    뒤이므로, 롤백이 없으면 그 행이 그대로 남는다.
    """
    publication_id, external_bid_id = validated_v2_publication(pipeline_services)
    _rename_scheme(pipeline_services, "eat:withdrawal-flag", "eat:withdrawal-flag-x")
    try:
        with pytest.raises(ProjectionContractError):
            project_publication(
                publication_id=publication_id,
                projector_version=BUILD_SHA,
                activated_at=ACTIVATED_AT,
                repository=pipeline_services.projection_repository,
            )
    finally:
        # 등록 목록은 컨테이너 하나를 공유하는 세션 자원이다. 되돌리지 않으면 뒤따르는 검증이
        # 자기 잘못이 아닌 이유로 실패한다.
        _rename_scheme(
            pipeline_services, "eat:withdrawal-flag-x", "eat:withdrawal-flag"
        )

    assert roster_rows(pipeline_services, external_bid_id) == []
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            """
            select count(*) from core.award_decision d
            join core.auction_attempt a using (auction_attempt_id)
            where a.external_bid_id = %s
            """,
            (external_bid_id,),
        )
        assert cursor.fetchone()[0] == 0
        cursor.execute(
            "select status from ingest.publication where publication_id = %s",
            (publication_id,),
        )
        assert cursor.fetchone()[0] == "failed"


def _rename_scheme(
    services: PipelineServices, namespace: str, renamed: str
) -> None:
    with services.connection.transaction(), services.connection.cursor() as cursor:
        cursor.execute(
            "update core.code_scheme set namespace = %s where namespace = %s",
            (renamed, namespace),
        )
        assert cursor.rowcount == 1


def test_재입찰_사슬은_상대_공고에_revision_없는_attempt를_만든다(
    pipeline_services: PipelineServices,
) -> None:
    publication_id, external_bid_id = validated_v2_publication(
        pipeline_services, fixture=REBID_FIXTURE
    )

    result = project_publication(
        publication_id=publication_id,
        projector_version=BUILD_SHA,
        activated_at=ACTIVATED_AT,
        repository=pipeline_services.projection_repository,
    )

    assert result.attempt_links_inserted >= 1
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            """
            select l.relation, t.external_bid_id,
                   (select count(*) from core.auction_revision r
                     where r.auction_attempt_id = t.auction_attempt_id)
            from core.auction_attempt_link l
            join core.auction_attempt t on t.auction_attempt_id = l.to_auction_attempt_id
            join core.auction_attempt f
              on f.auction_attempt_id = l.from_auction_attempt_id
            where f.external_bid_id = %s
            order by t.external_bid_id, l.relation
            """,
            (external_bid_id,),
        )
        links = cursor.fetchall()

    assert links
    assert {row[0] for row in links} <= {"parent", "chain_member"}
    # 아직 수집하지 않은 상대는 revision 0개인 attempt다. 그것은 오류가 아니라 관계로만 알려진 공고다.
    assert any(row[2] == 0 for row in links)
