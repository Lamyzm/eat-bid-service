"""모듈 책임: 기대 질의가 실제 PostgreSQL에서 의도한 행만 내는지 고정한다."""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from eatbid.monitoring.expectations import (
    EXPECTATIONS,
    MONTH_WINDOW_PREDICATE,
    evaluate,
)

from .conftest import MigratedDatabase

SEOUL = ZoneInfo("Asia/Seoul")


def _기대(key: str):
    return next(expectation for expectation in EXPECTATIONS if expectation.key == key)


def test_수집_신선도_기대는_영업시간_밖에서_울리지_않는다(
    migrated_db: MigratedDatabase,
) -> None:
    """빈 표에 걸었을 때 창 안이면 위반, 창 밖이면 침묵이어야 한다.

    2026-09-14 21시에 이 질의가 `last_poll_open_at=None`으로 울렸다. 영업시간 판정이 `where`에 있어
    창 밖에서는 행이 하나도 안 남았고, 집계 질의는 그래도 한 행을 내므로 `max()`가 NULL이 되어
    `is null` 가지가 참이 됐다. 매일 저녁과 주말마다 나던 거짓 경보다.

    기대값을 파이썬 시계에서 계산하는 이유는 이 검사가 하루 중 언제 돌든 같은 판정을 해야 하기
    때문이다. `now()`를 고정하지 않고도 두 갈래를 모두 덮는다.
    """
    expectation = _기대("capture-freshness")
    지금 = datetime.now(SEOUL)
    창_안 = 지금.isoweekday() <= 5 and (
        int(expectation.parameters["window_start_hour"])
        <= 지금.hour
        <= int(expectation.parameters["window_end_hour"])
    )

    with migrated_db.connect() as connection, connection.cursor() as cursor:
        cursor.execute(expectation.sql, expectation.parameters)
        rows = cursor.fetchall()

    # 표가 비어 있으므로 창 안이면 "한 번도 안 돌았다"가 진짜 위반이고, 창 밖이면 할 말이 없어야 한다.
    assert bool(rows) is 창_안


def test_발행_실패_창_기대는_전진이_보는_달_전체_창만_고른다(
    migrated_db: MigratedDatabase,
) -> None:
    """poll-open의 하루 창과 반달 창은 전진 대상이 아니므로 이 기대의 대상도 아니다.

    2026-09-16 20260916 하루 창이 옛 이미지의 발행 실패 하나를 들고 하루 종일 완결이 오가며 위반을
    열었다 닫았다 했다(EAT-240). 조건식을 view 밖에서 값 표에 걸어 실제 PostgreSQL 판정을 고정한다.
    """
    assert MONTH_WINDOW_PREDICATE in _기대("failed-publication-window").sql

    with migrated_db.connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            "select window_start from (values"
            " ('20260301', '20260331'), ('20260916', '20260916'), ('20260201', '20260228'),"
            " ('20260101', '20260115'), ('20260401', '20260430'), ('20240201', '20240229')"
            f") as w(window_start, window_end) where {MONTH_WINDOW_PREDICATE} order by 1"
        )
        picked = [row[0] for row in cursor.fetchall()]

    assert picked == ["20240201", "20260201", "20260301", "20260401"]


def test_모든_기대_질의가_빈_스키마에서도_실행된다(
    migrated_db: MigratedDatabase,
) -> None:
    """질의가 깨지면 `evaluate`가 그것을 위반으로 올린다. 그 길로 새는 기대가 없어야 한다.

    `request_unit.updated_at`처럼 존재하지 않는 컬럼을 가정해 만든 전례가 있다(EAT-170).
    """
    with migrated_db.connect() as connection:

        def run_query(
            sql: str, parameters: dict[str, object]
        ) -> list[dict[str, object]]:
            with connection.cursor() as cursor:
                cursor.execute(sql, parameters)
                columns = [column.name for column in cursor.description or ()]
                return [
                    dict(zip(columns, row, strict=True)) for row in cursor.fetchall()
                ]

        violations = evaluate(run_query)

    assert [
        violation.key for violation in violations if "check-failed" in violation.key
    ] == []
