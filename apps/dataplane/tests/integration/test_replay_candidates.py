"""모듈 책임: 자동 재처리가 고르는 후보 질의가 실제 스키마에서 돌고 커버리지 view를 근거로 쓰는지 고정한다."""

from __future__ import annotations

from psycopg.rows import dict_row

from eatbid.composition import _REPLAY_CANDIDATES_SQL

from .conftest import MigratedDatabase


def test_재처리_후보_질의가_빈_스키마에서도_돌고_열_넷을_낸다(
    migrated_db: MigratedDatabase,
) -> None:
    """composition이 실행하는 문장 그대로다. 열이나 뷰가 바뀌면 운영이 아니라 여기서 먼저 깨진다."""
    with migrated_db.connect() as connection, connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(_REPLAY_CANDIDATES_SQL)
        columns = [description.name for description in cursor.description or ()]
        assert columns == ["source_release_id", "publication_id", "build_sha", "window_start"]


def test_후보_질의가_커버리지_뷰를_근거로_쓴다() -> None:
    """이 단언이 지키는 것은 문자열이 아니라 **누가 진도를 정의하는가**다.

    이전 판은 "이 release에 published publication이 없으면 미완"으로 스스로 판단했다. 그러면 한 창을
    뒤이은 다른 release가 채운 경우를 못 본다 — 2026-09-20 운영에서 후보 13개 중 열 개가 이미
    `is_complete`인 창이었고, 최신순 첫 하나를 고르는 규칙 탓에 매 회차가 끝난 창을 다시 발행하면서
    실제로 막힌 2024-07·08·10이 차례를 못 받았다.

    진도는 파생이고 그 view가 정의를 소유한다(ADR 0052 결정 2). 후보 질의가 자기 판단으로 돌아가면
    같은 사실이 두 곳에서 갈린다.
    """
    assert "ingest.backfill_coverage" in _REPLAY_CANDIDATES_SQL
    assert "not c.is_complete" in _REPLAY_CANDIDATES_SQL
    # 창을 잇는 두 축이 모두 있어야 커버리지 행과 1:1로 붙는다. 시작일만 쓰면 같은 달의 다른 끝일이
    # 같은 행으로 접힌다.
    assert "P_BID_END_DT" in _REPLAY_CANDIDATES_SQL
