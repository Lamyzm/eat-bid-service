"""제외로 완결된 창을 전진은 다시 받지 않고, replay 후보와 감시 기대는 해소될 때까지 드러내는지 실제 스키마에서
고정한다(ADR 0061 결정 5, EAT-294)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from uuid import UUID, uuid4

from psycopg import Cursor
from psycopg.rows import DictRow, dict_row

from eatbid.composition import _REPLAY_CANDIDATES_SQL
from eatbid.monitoring.expectations import EXPECTATIONS
from eatbid.pipeline.advance import CompletedWindow, next_window
from eatbid.pipeline.replay_target import STALLED_VALIDATED_AFTER

from .conftest import MigratedDatabase

# 다른 테스트가 같은 session DB를 보므로 겹치지 않는 먼 과거의 달 창을 쓴다.
WINDOW_START = "19970101"
WINDOW_END = "19970131"
옛이미지 = "a" * 40
새이미지 = "c" * 40
기준 = datetime(2026, 9, 29, 3, 0, tzinfo=UTC)


@dataclass(frozen=True)
class _제외된_창:
    release_id: UUID
    publication_id: UUID
    observation_id: int


def _해시() -> str:
    return uuid4().hex + uuid4().hex


def _제외된_창을_심는다(cursor: Cursor[DictRow]) -> _제외된_창:
    """봉인된 release 하나, 관측 하나, 그리고 그 관측을 원장에 제외로 적고 발행된 publication을 만든다.

    관측에 revision이 없으므로 제외는 미해소이고, 원장 덕에 창은 완결이다. ADR 0061이 만드는 모양 그대로다.
    """
    run_id = uuid4()
    release_id = uuid4()
    publication_id = uuid4()
    started_at = 기준 - timedelta(days=2)
    cursor.execute(
        """
        insert into ingest.run (run_id, mode, status, build_sha, parser_version, started_at, ended_at,
                                expected_count, captured_count, published_count, excluded_count)
        values (%s, 'backfill', 'published', %s, 'eat-v3', %s, %s, 1, 1, 0, 1)
        """,
        (run_id, 옛이미지, started_at, started_at + timedelta(hours=1)),
    )
    cursor.execute(
        """
        insert into ingest.source_release (source_release_id, source, release_name, status, as_of)
        values (%s, 'eat', %s, 'planned', %s)
        """,
        (release_id, f"exclusion-window-{release_id}", started_at),
    )
    # 봉인 trigger는 required dataset 행을 요구한다. 격리 1건이 봉인된 모양 그대로다.
    cursor.execute(
        """
        insert into ingest.source_release_dataset (
            source_release_id, endpoint, dataset, record_type, parser_version,
            schema_fingerprint, expected_count, observed_count, normalized_count,
            quarantined_count, required
        ) values (%s, 'bid-detail', 'eat-bid-detail', 'auction.v1', 'eat-v3', %s, 1, 1, 0, 1, true)
        """,
        (release_id, _해시()),
    )
    cursor.execute(
        "insert into ingest.source_release_run (source_release_id, run_id) values (%s, %s)",
        (release_id, run_id),
    )
    cursor.execute(
        """
        insert into ingest.request_unit (run_id, source, endpoint, request_params, request_params_hash,
                                         expected_count, observed_count, status)
        values (%s, 'eat', 'bid-list', %s::jsonb, %s, 1, 1, 'captured')
        """,
        (
            run_id,
            f'{{"P_BID_BGNG_DT": "{WINDOW_START}", "P_BID_END_DT": "{WINDOW_END}"}}',
            _해시(),
        ),
    )
    detail_params = f'{{"ELCTRN_BID_ID": "{uuid4().hex[:10]}"}}'
    cursor.execute(
        """
        insert into ingest.request_unit (run_id, source, endpoint, request_params, request_params_hash,
                                         expected_count, observed_count, status)
        values (%s, 'eat', 'bid-detail', %s::jsonb, %s, 1, 1, 'captured')
        returning request_unit_id
        """,
        (run_id, detail_params, _해시()),
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
        (blob_sha, f"test/exclusion-window/{release_id}"),
    )
    cursor.execute(
        """
        insert into ingest.raw_observation (run_id, request_unit_id, source, endpoint, request_params,
                                            fetched_at, http_status, content_sha256)
        values (%s, %s, 'eat', 'bid-detail', %s::jsonb, now(), 200, %s)
        returning observation_id
        """,
        (run_id, unit["request_unit_id"], detail_params, blob_sha),
    )
    observation = cursor.fetchone()
    assert observation is not None
    observation_id = int(observation["observation_id"])
    cursor.execute(
        "insert into ingest.source_release_observation (source_release_id, observation_id) values (%s, %s)",
        (release_id, observation_id),
    )
    cursor.execute(
        """
        update ingest.source_release
           set status = 'sealed', manifest_sha256 = %s, sealed_at = %s
         where source_release_id = %s
        """,
        (_해시(), started_at, release_id),
    )
    cursor.execute(
        """
        insert into ingest.publication (publication_id, run_id, status, validated_at, activated_at,
                                        expected_count, normalized_count, published_count, excluded_count,
                                        canonical_fingerprint, projector_version)
        values (%s, %s, 'published', %s, %s, 1, 0, 0, 1, %s, %s)
        """,
        (publication_id, run_id, started_at, started_at, "0" * 64, 옛이미지),
    )
    cursor.execute(
        """
        insert into ingest.publication_exclusion (publication_id, observation_id, stage, reason_code, reason)
        values (%s, %s, 'normalize', 'SOURCE_XML_BROKEN', 'unsafe or malformed Nexacro XML: test')
        """,
        (publication_id, observation_id),
    )
    return _제외된_창(release_id, publication_id, observation_id)


def _replay를_남긴다(cursor: Cursor[DictRow], 창: _제외된_창, *, build_sha: str, started_at: datetime) -> UUID:
    """replay run은 source_release_run에 매이지 않는다. 관측 매니페스트로만 release와 이어진다."""
    run_id = uuid4()
    publication_id = uuid4()
    cursor.execute(
        """
        insert into ingest.run (run_id, mode, status, build_sha, parser_version, started_at,
                                expected_count, captured_count, published_count)
        values (%s, 'replay', 'running', %s, 'eat-v3', %s, 1, 0, 0)
        """,
        (run_id, build_sha, started_at),
    )
    cursor.execute(
        "insert into ingest.replay_input (run_id, observation_id) values (%s, %s)",
        (run_id, 창.observation_id),
    )
    cursor.execute(
        """
        insert into ingest.publication (publication_id, run_id, status, expected_count,
                                        normalized_count, published_count)
        values (%s, %s, 'pending', 1, 0, 0)
        """,
        (publication_id, run_id),
    )
    return publication_id


def _후보(cursor: Cursor[DictRow], 창: _제외된_창) -> list[dict[str, object]]:
    cursor.execute(
        _REPLAY_CANDIDATES_SQL, {"as_of": 기준, "stall_after": STALLED_VALIDATED_AFTER}
    )
    return [dict(row) for row in cursor.fetchall() if row["source_release_id"] == 창.release_id]


def test_제외로_완결된_창은_전진이_매시_다시_받지_않는다(migrated_db: MigratedDatabase) -> None:
    """ADR 0053이 막은 재수집 반복을 제외가 되살리면 안 된다. 전진은 view의 `is_complete`만 본다."""
    with migrated_db.connect() as connection, connection.cursor(row_factory=dict_row) as cursor:
        try:
            _제외된_창을_심는다(cursor)
            cursor.execute(
                "select window_start, window_end, is_complete, failed_publications,"
                " unresolved_exclusions from ingest.backfill_coverage"
                " where window_start = %s and window_end = %s",
                (WINDOW_START, WINDOW_END),
            )
            row = cursor.fetchone()
            assert row is not None
            assert (row["is_complete"], row["unresolved_exclusions"]) == (True, 1)

            picked = next_window(
                as_of=date(1997, 2, 15),
                floor=date(1997, 1, 1),
                coverage=(
                    CompletedWindow(
                        start_date=str(row["window_start"]),
                        end_date=str(row["window_end"]),
                        is_complete=bool(row["is_complete"]),
                        failed_publications=int(row["failed_publications"]),
                    ),
                ),
            )
            assert picked is None
        finally:
            connection.rollback()


def test_미해소_제외가_남은_창은_excluded_후보로_제외를_적은_이미지와_함께_나온다(
    migrated_db: MigratedDatabase,
) -> None:
    with migrated_db.connect() as connection, connection.cursor(row_factory=dict_row) as cursor:
        try:
            창 = _제외된_창을_심는다(cursor)

            후보 = _후보(cursor, 창)

            assert [(row["state"], row["build_sha"], row["publication_id"]) for row in 후보] == [
                ("excluded", 옛이미지, 창.publication_id)
            ]
            assert 후보[0]["validated_at"] is None
            assert 후보[0]["last_replay_started_at"] is None
        finally:
            connection.rollback()


def test_제외_후보의_이미지는_그_관측을_마지막으로_시도한_replay의_것이다(
    migrated_db: MigratedDatabase,
) -> None:
    """새 이미지의 replay가 또 제외하거나 실패해도 그 시도가 "이 이미지로는 해 봤다"를 남긴다.

    제외를 처음 적은 이미지를 쓰면 지금 이미지가 매 회차 같은 창을 다시 고른다.
    """
    with migrated_db.connect() as connection, connection.cursor(row_factory=dict_row) as cursor:
        try:
            창 = _제외된_창을_심는다(cursor)
            replay_publication = _replay를_남긴다(
                cursor, 창, build_sha=새이미지, started_at=기준 - timedelta(hours=3)
            )

            후보 = _후보(cursor, 창)

            assert [(row["state"], row["build_sha"], row["publication_id"]) for row in 후보] == [
                ("excluded", 새이미지, replay_publication)
            ]
        finally:
            connection.rollback()


def test_미해소_제외_기대는_창마다_위반을_연다(migrated_db: MigratedDatabase) -> None:
    기대 = next(item for item in EXPECTATIONS if item.key == "unresolved-exclusion")
    with migrated_db.connect() as connection, connection.cursor(row_factory=dict_row) as cursor:
        try:
            cursor.execute(기대.sql, dict(기대.parameters))
            이전 = {(row["window_start"], row["window_end"]) for row in cursor.fetchall()}
            assert (WINDOW_START, WINDOW_END) not in 이전

            _제외된_창을_심는다(cursor)
            cursor.execute(기대.sql, dict(기대.parameters))
            행들 = [
                dict(row)
                for row in cursor.fetchall()
                if (row["window_start"], row["window_end"]) == (WINDOW_START, WINDOW_END)
            ]

            assert len(행들) == 1
            assert (행들[0]["unresolved_exclusions"], 행들[0]["excluded_ids"]) == (1, 1)
        finally:
            connection.rollback()
