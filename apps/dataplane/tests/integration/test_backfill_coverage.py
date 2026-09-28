"""모듈 책임: 전진 판단이 읽는 backfill_coverage view의 열과, 발행 제외 원장이 완결·미해소 수에 들어가는 규칙을 실제 스키마에서 고정한다."""

from __future__ import annotations

from uuid import uuid4

from psycopg import Cursor
from psycopg.rows import DictRow, dict_row

from .conftest import MigratedDatabase

# composition.next_backfill_window가 실행하는 문장 그대로다. view가 열을 바꾸면 여기서 먼저 깨져야 한다.
ADVANCE_SQL = (
    "select window_start, window_end, is_complete, failed_publications from ingest.backfill_coverage"
)

# 다른 테스트가 같은 session DB를 보므로 겹치지 않는 먼 과거 창을 쓴다.
WINDOW_START = "19990101"
WINDOW_END = "19990131"
FINGERPRINT = "0" * 64


def test_전진이_읽는_coverage_열_넷이_빈_스키마에서도_돈다(migrated_db: MigratedDatabase) -> None:
    with migrated_db.connect() as connection, connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(ADVANCE_SQL)
        columns = [description.name for description in cursor.description or ()]
        rows = cursor.fetchall()

    assert columns == ["window_start", "window_end", "is_complete", "failed_publications"]
    # 실패한 발행이 없는 창은 0이지 NULL이 아니다 — 전진이 int()로 읽는다.
    assert all(row["failed_publications"] >= 0 for row in rows)


def _insert_run(cursor: Cursor[DictRow], *, status: str, expected: int, excluded: int) -> str:
    run_id = str(uuid4())
    failure = "DATA_QUARANTINED" if status == "failed" else None
    cursor.execute(
        """
        insert into ingest.run (run_id, mode, status, build_sha, parser_version, started_at, ended_at,
                                failure_category, expected_count, captured_count, published_count, excluded_count)
        values (%s, 'backfill', %s, %s, 'eat-v3', now(), now(), %s, %s, %s, 0, %s)
        """,
        (run_id, status, "a" * 40, failure, expected, expected, excluded),
    )
    return run_id


def _insert_publication(cursor: Cursor[DictRow], run_id: str, *, published: bool, expected: int, excluded: int) -> str:
    publication_id = str(uuid4())
    if published:
        cursor.execute(
            """
            insert into ingest.publication (publication_id, run_id, status, validated_at, activated_at,
                                            expected_count, normalized_count, published_count, excluded_count,
                                            canonical_fingerprint, projector_version)
            values (%s, %s, 'published', now(), now(), %s, 0, 0, %s, %s, 'projector-test')
            """,
            (publication_id, run_id, expected, excluded, FINGERPRINT),
        )
    else:
        cursor.execute(
            """
            insert into ingest.publication (publication_id, run_id, status, validated_at,
                                            expected_count, normalized_count, published_count)
            values (%s, %s, 'failed', now(), %s, 0, 0)
            """,
            (publication_id, run_id, expected),
        )
    return publication_id


def _exclude(cursor: Cursor[DictRow], publication_id: str, observation_id: int) -> None:
    cursor.execute(
        """
        insert into ingest.publication_exclusion (publication_id, observation_id, stage, reason_code, reason)
        values (%s, %s, 'normalize', 'SOURCE_XML_BROKEN', '한 공고의 XML이 깨졌다')
        """,
        (publication_id, observation_id),
    )


def _coverage(cursor: Cursor[DictRow]) -> dict[str, object]:
    cursor.execute(
        """
        select discovered_ids, published_ids, excluded_ids, unresolved_exclusions, is_complete
          from ingest.backfill_coverage
         where window_start = %s and window_end = %s
        """,
        (WINDOW_START, WINDOW_END),
    )
    row = cursor.fetchone()
    assert row is not None
    return dict(row)


def test_발행_원장에_적힌_제외만_정산으로_세고_실패한_발행의_제외는_세지_않는다(
    migrated_db: MigratedDatabase,
) -> None:
    """제외가 없으면 이전과 같이 미완이고, 발행된 원장에 적힌 공고만 완결 쪽으로 넘어간다(ADR 0061 결정 5).

    revision이 없는 제외는 전부 미해소다. 실패한 발행의 원장 행은 공개된 결손이 아니므로 세지 않는다.
    """
    with migrated_db.connect() as connection, connection.cursor(row_factory=dict_row) as cursor:
        try:
            run_id = _insert_run(cursor, status="published", expected=2, excluded=2)
            release_id = str(uuid4())
            cursor.execute(
                """
                insert into ingest.source_release (source_release_id, source, release_name, status, as_of)
                values (%s, 'eat', %s, 'planned', now())
                """,
                (release_id, f"coverage-exclusion-{release_id}"),
            )
            cursor.execute(
                "insert into ingest.source_release_run (source_release_id, run_id) values (%s, %s)",
                (release_id, run_id),
            )
            cursor.execute(
                """
                insert into ingest.raw_blob (content_sha256, object_key, byte_length, content_type,
                                             content_encoding, stored_at)
                values (%s, %s, 1, 'application/xml', 'identity', now())
                """,
                ("b" * 64, f"test/coverage-exclusion/{release_id}"),
            )
            cursor.execute(
                """
                insert into ingest.request_unit (run_id, source, endpoint, request_params, request_params_hash,
                                                 expected_count, observed_count, status)
                values (%s, 'eat', 'bid-list', %s::jsonb, %s, 2, 2, 'captured')
                """,
                (
                    run_id,
                    f'{{"P_BID_BGNG_DT": "{WINDOW_START}", "P_BID_END_DT": "{WINDOW_END}"}}',
                    "c" * 64,
                ),
            )
            observation_ids: list[int] = []
            for index, bid_id in enumerate(("9990001", "9990002")):
                params = f'{{"ELCTRN_BID_ID": "{bid_id}"}}'
                cursor.execute(
                    """
                    insert into ingest.request_unit (run_id, source, endpoint, request_params, request_params_hash,
                                                     expected_count, observed_count, status)
                    values (%s, 'eat', 'bid-detail', %s::jsonb, %s, 1, 1, 'captured')
                    returning request_unit_id
                    """,
                    (run_id, params, str(index + 1) * 64),
                )
                unit = cursor.fetchone()
                assert unit is not None
                cursor.execute(
                    """
                    insert into ingest.raw_observation (run_id, request_unit_id, source, endpoint, request_params,
                                                        fetched_at, http_status, content_sha256)
                    values (%s, %s, 'eat', 'bid-detail', %s::jsonb, now(), 200, %s)
                    returning observation_id
                    """,
                    (run_id, unit["request_unit_id"], params, "b" * 64),
                )
                observation = cursor.fetchone()
                assert observation is not None
                observation_ids.append(int(observation["observation_id"]))

            # 원장이 비어 있으면 이전 정의 그대로 미완이다.
            assert _coverage(cursor) == {
                "discovered_ids": 2,
                "published_ids": 0,
                "excluded_ids": 0,
                "unresolved_exclusions": 0,
                "is_complete": False,
            }

            failed_run = _insert_run(cursor, status="failed", expected=2, excluded=0)
            failed_publication = _insert_publication(cursor, failed_run, published=False, expected=2, excluded=0)
            _exclude(cursor, failed_publication, observation_ids[1])
            published_publication = _insert_publication(cursor, run_id, published=True, expected=2, excluded=2)
            _exclude(cursor, published_publication, observation_ids[0])

            assert _coverage(cursor) == {
                "discovered_ids": 2,
                "published_ids": 0,
                "excluded_ids": 1,
                "unresolved_exclusions": 1,
                "is_complete": False,
            }

            _exclude(cursor, published_publication, observation_ids[1])

            assert _coverage(cursor) == {
                "discovered_ids": 2,
                "published_ids": 0,
                "excluded_ids": 2,
                "unresolved_exclusions": 2,
                "is_complete": True,
            }
        finally:
            connection.rollback()
