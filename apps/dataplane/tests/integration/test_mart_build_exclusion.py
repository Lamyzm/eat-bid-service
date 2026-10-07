"""발행 제외 원장이 mart build의 달별 제외 수와 "최신 관측 반영 안 됨" 공고로 옮겨지는 규칙을 실제 스키마에서
고정한다(ADR 0061 결정 5·6, EAT-295)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from uuid import UUID, uuid4

from psycopg import Cursor
from psycopg.rows import DictRow, dict_row

from eatbid.mart.build_exclusion import fill_build_exclusions

from .conftest import MigratedDatabase
from .mart_support import mart_plan

# 다른 테스트가 같은 session DB를 보므로 겹치지 않는 먼 과거의 달을 쓴다.
MONTH_START = "19910301"
MONTH_END = "19910331"
OTHER_MONTH_START = "19910401"
OTHER_MONTH_END = "19910430"
기준 = datetime(2026, 9, 29, 3, 0, tzinfo=UTC)


def _해시() -> str:
    return uuid4().hex + uuid4().hex


@dataclass(frozen=True)
class _창:
    release_id: UUID
    run_id: UUID


def _창을_연다(cursor: Cursor[DictRow], *, start: str, end: str) -> _창:
    """release 하나와 그 release의 목록 창 하나를 만든다. 제외 관측의 달은 이 창이 정한다."""
    run_id = uuid4()
    release_id = uuid4()
    cursor.execute(
        """
        insert into ingest.run (run_id, mode, status, build_sha, parser_version, started_at,
                                expected_count, captured_count, published_count)
        values (%s, 'backfill', 'planned', %s, 'eat-v3', %s, 0, 0, 0)
        """,
        (run_id, "a" * 40, 기준),
    )
    cursor.execute(
        """
        insert into ingest.source_release (source_release_id, source, release_name, status, as_of)
        values (%s, 'eat', %s, 'planned', %s)
        """,
        (release_id, f"exclusion-mart-{release_id}", 기준),
    )
    cursor.execute(
        "insert into ingest.source_release_run (source_release_id, run_id) values (%s, %s)",
        (release_id, run_id),
    )
    cursor.execute(
        """
        insert into ingest.request_unit (run_id, source, endpoint, request_params, request_params_hash,
                                         expected_count, observed_count, status)
        values (%s, 'eat', 'bid-list',
                jsonb_build_object('P_BID_BGNG_DT', %s::text, 'P_BID_END_DT', %s::text), %s, 1, 1, 'captured')
        """,
        (run_id, start, end, _해시()),
    )
    return _창(release_id, run_id)


def _관측을_받는다(
    cursor: Cursor[DictRow], 창: _창, *, bid_id: str, fetched_at: datetime
) -> int:
    """그 창의 run이 공고 상세 하나를 받은 관측을 만든다."""
    params = f'{{"ELCTRN_BID_ID": "{bid_id}"}}'
    cursor.execute(
        """
        insert into ingest.request_unit (run_id, source, endpoint, request_params, request_params_hash,
                                         expected_count, observed_count, status)
        values (%s, 'eat', 'bid-detail', %s::jsonb, %s, 1, 1, 'captured')
        returning request_unit_id
        """,
        (창.run_id, params, _해시()),
    )
    unit = cursor.fetchone()
    assert unit is not None
    blob_sha = _해시()
    cursor.execute(
        """
        insert into ingest.raw_blob (content_sha256, object_key, byte_length, content_type,
                                     content_encoding, stored_at)
        values (%s, %s, 1, 'application/xml', 'identity', now())
        """,
        (blob_sha, f"test/exclusion-mart/{blob_sha}"),
    )
    cursor.execute(
        """
        insert into ingest.raw_observation (run_id, request_unit_id, source, endpoint, request_params,
                                            fetched_at, http_status, content_sha256)
        values (%s, %s, 'eat', 'bid-detail', %s::jsonb, %s, 200, %s)
        returning observation_id
        """,
        (창.run_id, unit["request_unit_id"], params, fetched_at, blob_sha),
    )
    observation = cursor.fetchone()
    assert observation is not None
    return int(observation["observation_id"])


def _제외를_적는다(
    cursor: Cursor[DictRow], observation_id: int, *, published: bool = True
) -> None:
    """관측 하나를 원장에 제외로 적은 발행을 만든다.

    발행은 run마다 하나라 제외마다 발행 run을 따로 둔다. 제외가 어느 달인지는 발행 run이 아니라 관측을 받은
    run의 release가 정하므로 이 run은 창에 매이지 않는다(replay 발행과 같은 모양).
    """
    publication_id = uuid4()
    run_id = uuid4()
    cursor.execute(
        """
        insert into ingest.run (run_id, mode, status, build_sha, parser_version, started_at,
                                expected_count, captured_count, published_count)
        values (%s, 'replay', 'running', %s, 'eat-v3', %s, 1, 0, 0)
        """,
        (run_id, "a" * 40, 기준),
    )
    if published:
        cursor.execute(
            """
            insert into ingest.publication (publication_id, run_id, status, validated_at, activated_at,
                                            expected_count, normalized_count, published_count, excluded_count,
                                            canonical_fingerprint, projector_version)
            values (%s, %s, 'published', %s, %s, 1, 0, 0, 1, %s, %s)
            """,
            (publication_id, run_id, 기준, 기준, "0" * 64, "a" * 40),
        )
    else:
        cursor.execute(
            """
            insert into ingest.publication (publication_id, run_id, status, expected_count,
                                            normalized_count, published_count)
            values (%s, %s, 'pending', 1, 0, 0)
            """,
            (publication_id, run_id),
        )
    cursor.execute(
        """
        insert into ingest.publication_exclusion (publication_id, observation_id, stage, reason_code, reason)
        values (%s, %s, 'normalize', 'SOURCE_XML_BROKEN', 'unsafe or malformed Nexacro XML: test')
        """,
        (publication_id, observation_id),
    )


def _revision을_만든다(
    cursor: Cursor[DictRow], observation_id: int, *, bid_id: str
) -> tuple[int, int]:
    """관측 하나를 해석한 revision을 core에 둔다. (attempt id, revision id)를 돌려준다."""
    cursor.execute(
        """
        insert into core.auction_attempt (source_system, external_bid_id) values ('eat', %s)
        on conflict on constraint auction_attempt_source_external_bid_key do nothing
        """,
        (bid_id,),
    )
    cursor.execute(
        "select auction_attempt_id from core.auction_attempt where source_system = 'eat' and external_bid_id = %s",
        (bid_id,),
    )
    attempt = cursor.fetchone()
    assert attempt is not None
    cursor.execute(
        """
        insert into ingest.normalized_record (observation_id, record_type, source_entity_id, normalized_payload,
                                              parser_version, normalized_at)
        values (%s, 'auction.v2', %s, '{}'::jsonb, 'eat-v3', now())
        returning normalized_record_id
        """,
        (observation_id, bid_id),
    )
    record = cursor.fetchone()
    assert record is not None
    cursor.execute(
        """
        insert into core.auction_revision (auction_attempt_id, normalized_record_id, observation_id, content_sha256,
                                           source_status, title, currency, lineage_observed)
        values (%s, %s, %s, %s, '진행중', '합성 공고', 'KRW', false)
        returning auction_revision_id
        """,
        (
            attempt["auction_attempt_id"],
            record["normalized_record_id"],
            observation_id,
            _해시(),
        ),
    )
    revision = cursor.fetchone()
    assert revision is not None
    return int(attempt["auction_attempt_id"]), int(revision["auction_revision_id"])


def _build를_채운다(cursor: Cursor[DictRow]) -> int:
    plan = mart_plan(uuid4(), parser_version="eat-v3")
    cursor.execute(
        """
        insert into ingest.source_release (source_release_id, source, release_name, status, as_of)
        values (%s, 'eat', %s, 'planned', %s)
        """,
        (plan.source_release_id, f"mart-{plan.source_release_id}", 기준),
    )
    cursor.execute(
        """
        insert into mart.build (mart_name, source_release_id, publication_id, calc_version, builder_version,
                                region_scheme, status, as_of, started_at)
        values (%s, %s, null, %s, %s, %s, 'building', %s, %s)
        returning build_id
        """,
        (
            plan.mart_name,
            plan.source_release_id,
            plan.calc_version,
            plan.builder_version,
            plan.region_scheme,
            plan.as_of,
            plan.started_at,
        ),
    )
    build = cursor.fetchone()
    assert build is not None
    build_id = int(build["build_id"])
    fill_build_exclusions(cursor.connection, plan=plan, build_id=build_id)
    return build_id


def _달별(cursor: Cursor[DictRow], build_id: int) -> dict[date, tuple[int, int]]:
    cursor.execute(
        """
        select month_kst, excluded_auction_count, unresolved_auction_count
          from mart.build_exclusion_month
         where build_id = %s and month_kst between '1991-01-01' and '1991-12-31'
        """,
        (build_id,),
    )
    return {
        row["month_kst"]: (
            int(row["excluded_auction_count"]),
            int(row["unresolved_auction_count"]),
        )
        for row in cursor.fetchall()
    }


def _미반영(
    cursor: Cursor[DictRow], build_id: int, attempt_id: int
) -> list[dict[str, object]]:
    cursor.execute(
        """
        select auction_revision_id, excluded_observed_at, reflected_observed_at
          from mart.build_stale_auction
         where build_id = %s and auction_attempt_id = %s
        """,
        (build_id, attempt_id),
    )
    return [dict(row) for row in cursor.fetchall()]


def test_달별_제외_수는_공고_단위로_세고_해소된_것은_미해소에서_뺀다(
    migrated_db: MigratedDatabase,
) -> None:
    with (
        migrated_db.connect() as connection,
        connection.cursor(row_factory=dict_row) as cursor,
    ):
        try:
            삼월 = _창을_연다(cursor, start=MONTH_START, end=MONTH_END)
            사월 = _창을_연다(cursor, start=OTHER_MONTH_START, end=OTHER_MONTH_END)
            # 같은 공고가 두 번 제외돼도 빠진 공고는 하나다.
            반복 = f"repeat-{uuid4().hex[:8]}"
            for 시각 in (기준, 기준 + timedelta(hours=1)):
                _제외를_적는다(
                    cursor, _관측을_받는다(cursor, 삼월, bid_id=반복, fetched_at=시각)
                )
            # 재파싱으로 revision을 얻은 제외는 원장에 남되 미해소가 아니다.
            해소 = f"resolved-{uuid4().hex[:8]}"
            해소_관측 = _관측을_받는다(cursor, 삼월, bid_id=해소, fetched_at=기준)
            _제외를_적는다(cursor, 해소_관측)
            _revision을_만든다(cursor, 해소_관측, bid_id=해소)
            _제외를_적는다(
                cursor,
                _관측을_받는다(
                    cursor, 사월, bid_id=f"april-{uuid4().hex[:8]}", fetched_at=기준
                ),
            )
            # 발행되지 않은 발행의 원장 행은 제외가 아니다.
            _제외를_적는다(
                cursor,
                _관측을_받는다(
                    cursor, 사월, bid_id=f"pending-{uuid4().hex[:8]}", fetched_at=기준
                ),
                published=False,
            )

            build_id = _build를_채운다(cursor)

            assert _달별(cursor, build_id) == {
                date(1991, 3, 1): (2, 1),
                date(1991, 4, 1): (1, 1),
            }
        finally:
            connection.rollback()


def test_공개된_공고의_더_늦은_관측이_제외되면_최신_관측_반영_안_됨으로_싣는다(
    migrated_db: MigratedDatabase,
) -> None:
    with (
        migrated_db.connect() as connection,
        connection.cursor(row_factory=dict_row) as cursor,
    ):
        try:
            창 = _창을_연다(cursor, start=MONTH_START, end=MONTH_END)
            공고 = f"stale-{uuid4().hex[:8]}"
            반영 = _관측을_받는다(cursor, 창, bid_id=공고, fetched_at=기준)
            attempt_id, revision_id = _revision을_만든다(cursor, 반영, bid_id=공고)
            제외_시각 = 기준 + timedelta(hours=2)
            _제외를_적는다(
                cursor, _관측을_받는다(cursor, 창, bid_id=공고, fetched_at=제외_시각)
            )

            build_id = _build를_채운다(cursor)

            assert _미반영(cursor, build_id, attempt_id) == [
                {
                    "auction_revision_id": revision_id,
                    "excluded_observed_at": 제외_시각,
                    "reflected_observed_at": 기준,
                }
            ]
        finally:
            connection.rollback()


def test_제외된_관측이_현행보다_이르거나_해소됐으면_미반영으로_싣지_않는다(
    migrated_db: MigratedDatabase,
) -> None:
    with (
        migrated_db.connect() as connection,
        connection.cursor(row_factory=dict_row) as cursor,
    ):
        try:
            창 = _창을_연다(cursor, start=MONTH_START, end=MONTH_END)
            # 제외 뒤에 받은 관측이 revision이 됐다 — 최신은 이미 반영돼 있다.
            이른 = f"earlier-{uuid4().hex[:8]}"
            _제외를_적는다(
                cursor, _관측을_받는다(cursor, 창, bid_id=이른, fetched_at=기준)
            )
            이른_attempt, _ = _revision을_만든다(
                cursor,
                _관측을_받는다(
                    cursor, 창, bid_id=이른, fetched_at=기준 + timedelta(hours=1)
                ),
                bid_id=이른,
            )
            # 제외된 관측이 재파싱으로 revision을 얻었다 — 해소됐다.
            해소 = f"replayed-{uuid4().hex[:8]}"
            해소_attempt, _ = _revision을_만든다(
                cursor,
                _관측을_받는다(cursor, 창, bid_id=해소, fetched_at=기준),
                bid_id=해소,
            )
            늦은_관측 = _관측을_받는다(
                cursor, 창, bid_id=해소, fetched_at=기준 + timedelta(hours=3)
            )
            _제외를_적는다(cursor, 늦은_관측)
            _revision을_만든다(cursor, 늦은_관측, bid_id=해소)

            build_id = _build를_채운다(cursor)

            assert _미반영(cursor, build_id, 이른_attempt) == []
            assert _미반영(cursor, build_id, 해소_attempt) == []
        finally:
            connection.rollback()
