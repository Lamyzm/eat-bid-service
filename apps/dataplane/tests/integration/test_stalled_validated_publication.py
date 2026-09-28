"""검증 뒤 멈춘 publication을 재처리 후보 질의와 감시 기대가 실제 스키마에서 같은 기준으로 보는지 고정한다(EAT-296)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from psycopg import Cursor
from psycopg.rows import DictRow, dict_row

from eatbid.composition import _REPLAY_CANDIDATES_SQL
from eatbid.monitoring.expectations import EXPECTATIONS
from eatbid.pipeline.replay_target import STALLED_VALIDATED_AFTER

from .conftest import MigratedDatabase

# 다른 테스트가 같은 session DB를 보므로 겹치지 않는 먼 과거의 이레 창을 쓴다(daily-reconcile 모양).
WINDOW_START = "19980916"
WINDOW_END = "19980922"


@dataclass(frozen=True)
class _멈춘_창:
    release_id: UUID
    publication_id: UUID
    observation_id: int
    validated_at: datetime


def _해시() -> str:
    return uuid4().hex + uuid4().hex


def _멈춘_발행을_심는다(
    cursor: Cursor[DictRow], *, validated_at: datetime, status: str = "validated"
) -> _멈춘_창:
    """봉인된 release 하나, 목록·상세 요청 단위, 관측 하나, 그리고 project 전에 멈춘 publication을 만든다.

    상세 관측에 revision이 없으므로 창은 미완결이다. 운영에서 멈춘 두 창과 같은 모양이다.
    """
    run_id = uuid4()
    release_id = uuid4()
    publication_id = uuid4()
    cursor.execute(
        """
        insert into ingest.run (run_id, mode, status, build_sha, parser_version, started_at,
                                expected_count, captured_count, published_count)
        values (%s, 'daily-reconcile', 'validated', %s, 'eat-v3', %s, 1, 1, 0)
        """,
        (run_id, "a" * 40, validated_at - timedelta(hours=1)),
    )
    cursor.execute(
        """
        insert into ingest.source_release (source_release_id, source, release_name, status, as_of)
        values (%s, 'eat', %s, 'planned', %s)
        """,
        (release_id, f"stalled-validated-{release_id}", validated_at),
    )
    cursor.execute(
        """
        insert into ingest.source_release_dataset (
            source_release_id, endpoint, dataset, record_type, parser_version,
            schema_fingerprint, expected_count, observed_count, normalized_count,
            quarantined_count, required
        ) values (%s, 'bid-detail', 'eat-bid-detail', 'auction.v1', 'eat-v3', %s, 1, 1, 1, 0, true)
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
        (blob_sha, f"test/stalled-validated/{release_id}"),
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
        """
        insert into ingest.source_release_observation (source_release_id, observation_id)
        values (%s, %s)
        """,
        (release_id, observation_id),
    )
    # 봉인은 planned에서만 넘어갈 수 있다. 상태 전이 trigger가 강제하므로 실행 경로와 같은 순서를 밟는다.
    cursor.execute(
        """
        update ingest.source_release
           set status = 'sealed', manifest_sha256 = %s, sealed_at = %s
         where source_release_id = %s
        """,
        (_해시(), validated_at, release_id),
    )
    cursor.execute(
        """
        insert into ingest.publication (publication_id, run_id, status, validated_at,
                                        expected_count, normalized_count, published_count)
        values (%s, %s, %s, %s, 1, 1, 0)
        """,
        (publication_id, run_id, status, validated_at),
    )
    return _멈춘_창(release_id, publication_id, observation_id, validated_at)


def _replay를_남긴다(cursor: Cursor[DictRow], 창: _멈춘_창, *, started_at: datetime) -> None:
    """replay run은 source_release_run에 매이지 않는다(운영 replay 44건 전부). 관측 매니페스트로만 잇는다."""
    run_id = uuid4()
    cursor.execute(
        """
        insert into ingest.run (run_id, mode, status, build_sha, parser_version, started_at,
                                expected_count, captured_count, published_count)
        values (%s, 'replay', 'running', %s, 'eat-v3', %s, 1, 0, 0)
        """,
        (run_id, "b" * 40, started_at),
    )
    cursor.execute(
        "insert into ingest.replay_input (run_id, observation_id) values (%s, %s)",
        (run_id, 창.observation_id),
    )


def _후보(cursor: Cursor[DictRow], 창: _멈춘_창, *, as_of: datetime) -> list[dict[str, object]]:
    cursor.execute(
        _REPLAY_CANDIDATES_SQL, {"as_of": as_of, "stall_after": STALLED_VALIDATED_AFTER}
    )
    return [dict(row) for row in cursor.fetchall() if row["source_release_id"] == 창.release_id]


def test_여섯_시간_넘게_validated인_미완결_창은_stalled_후보가_되고_replay_시각을_함께_낸다(
    migrated_db: MigratedDatabase,
) -> None:
    기준 = datetime(2026, 9, 29, 3, 0, tzinfo=UTC)
    with migrated_db.connect() as connection, connection.cursor(row_factory=dict_row) as cursor:
        try:
            창 = _멈춘_발행을_심는다(cursor, validated_at=기준 - timedelta(hours=7))

            후보 = _후보(cursor, 창, as_of=기준)
            assert [(row["publication_id"], row["state"]) for row in 후보] == [
                (창.publication_id, "stalled")
            ]
            assert 후보[0]["validated_at"] == 창.validated_at
            assert 후보[0]["last_replay_started_at"] is None

            # 멈추기 전의 replay는 "멈춘 뒤 다시 시도했다"가 아니다.
            _replay를_남긴다(cursor, 창, started_at=창.validated_at - timedelta(days=1))
            assert _후보(cursor, 창, as_of=기준)[0]["last_replay_started_at"] is None

            뒤의_replay = 창.validated_at + timedelta(hours=2)
            _replay를_남긴다(cursor, 창, started_at=뒤의_replay)
            assert _후보(cursor, 창, as_of=기준)[0]["last_replay_started_at"] == 뒤의_replay
        finally:
            connection.rollback()


def test_막_검증된_발행은_아직_멈춘_것으로_보지_않는다(
    migrated_db: MigratedDatabase,
) -> None:
    """한 창의 project는 한 시간 남짓이라 도는 발행을 멈춤으로 오판하면 같은 창을 두 번 발행하게 된다."""
    기준 = datetime(2026, 9, 29, 3, 0, tzinfo=UTC)
    with migrated_db.connect() as connection, connection.cursor(row_factory=dict_row) as cursor:
        try:
            창 = _멈춘_발행을_심는다(cursor, validated_at=기준 - timedelta(hours=1))

            assert _후보(cursor, 창, as_of=기준) == []
        finally:
            connection.rollback()


def test_실패한_발행은_여전히_failed_후보로_나온다(migrated_db: MigratedDatabase) -> None:
    기준 = datetime(2026, 9, 29, 3, 0, tzinfo=UTC)
    with migrated_db.connect() as connection, connection.cursor(row_factory=dict_row) as cursor:
        try:
            창 = _멈춘_발행을_심는다(
                cursor, validated_at=기준 - timedelta(minutes=5), status="failed"
            )

            후보 = _후보(cursor, 창, as_of=기준)
            assert [(row["publication_id"], row["state"]) for row in 후보] == [
                (창.publication_id, "failed")
            ]
            assert 후보[0]["last_replay_started_at"] is None
        finally:
            connection.rollback()


def test_멈춘_발행_기대는_여섯_시간_넘은_미완결_창만_publication마다_알린다(
    migrated_db: MigratedDatabase,
) -> None:
    기대 = next(item for item in EXPECTATIONS if item.key == "stale-validated-publication")
    assert 기대.key_columns == ("publication_id",)
    assert 기대.severity == "normal"
    지금 = datetime.now(UTC)
    with migrated_db.connect() as connection, connection.cursor(row_factory=dict_row) as cursor:
        try:
            멈춘 = _멈춘_발행을_심는다(cursor, validated_at=지금 - timedelta(hours=7))
            막_검증된 = _멈춘_발행을_심는다(cursor, validated_at=지금 - timedelta(hours=1))

            cursor.execute(기대.sql, dict(기대.parameters))
            publication_ids = {row["publication_id"] for row in cursor.fetchall()}

            assert str(멈춘.publication_id) in publication_ids
            assert str(막_검증된.publication_id) not in publication_ids
        finally:
            connection.rollback()
