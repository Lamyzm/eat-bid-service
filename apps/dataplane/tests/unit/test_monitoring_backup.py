"""모듈 책임: 백업이 늦은 것과 비어 있는 것을 가르는 경계를 R2 없이 고정한다."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from eatbid.monitoring.backup import (
    BACKUP_EXPECTATIONS,
    BackupExpectation,
    BackupObject,
    evaluate_backups,
    judge_backups,
)

_지금 = datetime(2026, 9, 14, 12, 0, tzinfo=UTC)

_기대 = BackupExpectation(
    key="backup-freshness",
    title="마지막 백업이 임계 시간 안에 있다",
    runbook="docs/operations/backup-and-restore.md",
    prefix="backup/postgres/hourly/",
    stale_after=timedelta(hours=3),
    minimum_bytes=1024 * 1024,
)


def _객체(*, hours_ago: float = 0.5, size_bytes: int = 2 * 1024 * 1024) -> BackupObject:
    stamp = _지금 - timedelta(hours=hours_ago)
    return BackupObject(
        key=f"backup/postgres/hourly/{stamp.strftime('%Y%m%dT%H%M%SZ')}.dump",
        last_modified=stamp,
        size_bytes=size_bytes,
    )


def test_최근_백업이_충분히_크면_위반이_없다() -> None:
    assert judge_backups(_기대, [_객체()], now=_지금) == []


def test_백업이_하나도_없으면_위반이다() -> None:
    # 백업은 이미 돌고 있다고 선언된 일이라 "없음"이 곧 "복구할 수 없음"이다.
    위반 = judge_backups(_기대, [], now=_지금)

    assert [v.key for v in 위반] == ["backup-freshness:missing"]


def test_임계를_넘게_오래되면_위반이다() -> None:
    위반 = judge_backups(_기대, [_객체(hours_ago=5)], now=_지금)

    assert [v.key for v in 위반] == ["backup-freshness:stale"]
    assert "5시간 전" in 위반[0].title


def test_한_회차_지연은_아직_위반이_아니다() -> None:
    # 좁게 잡으면 재부팅이나 잠깐의 노드 압박에도 울려 사람이 알림을 무시하게 된다.
    assert judge_backups(_기대, [_객체(hours_ago=2)], now=_지금) == []


def test_덤프가_너무_작으면_신선해도_위반이다() -> None:
    위반 = judge_backups(_기대, [_객체(size_bytes=4096)], now=_지금)

    assert [v.key for v in 위반] == ["backup-freshness:too-small"]


def test_늦은_것과_작은_것은_key가_달라_서로를_덮지_않는다() -> None:
    위반 = judge_backups(_기대, [_객체(hours_ago=9, size_bytes=0)], now=_지금)

    assert sorted(v.key for v in 위반) == [
        "backup-freshness:stale",
        "backup-freshness:too-small",
    ]


def test_가장_최근_객체로만_판정한다() -> None:
    # 옛 백업이 아무리 많아도 복구에 쓰이는 것은 마지막 하나다.
    위반 = judge_backups(
        _기대,
        [_객체(hours_ago=50), _객체(hours_ago=0.2), _객체(hours_ago=20)],
        now=_지금,
    )

    assert 위반 == []


def test_조회가_실패하면_그_사실을_위반으로_올린다() -> None:
    def 실패(_: BackupExpectation) -> list[BackupObject]:
        raise PermissionError("자격 없음")

    위반 = evaluate_backups(실패, [_기대], now=_지금)

    assert [v.key for v in 위반] == ["backup-freshness:check-failed"]
    assert "PermissionError" in 위반[0].detail


def test_선언된_백업_자리는_매시_회차_둘을_참는다() -> None:
    # 백업 cron이 매시 5분이므로 임계가 두 시간 이하면 한 회차만 놓쳐도 울린다.
    for 기대 in BACKUP_EXPECTATIONS:
        assert 기대.stale_after > timedelta(hours=2)
