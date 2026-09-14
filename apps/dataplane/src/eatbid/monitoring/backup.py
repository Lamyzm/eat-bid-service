"""모듈 책임: 마지막 백업이 제때, 제대로 된 크기로 R2에 놓였는지 객체 목록만 보고 판정한다.

왜 Workflow 성공이 아니라 객체를 보는가: 2026-09-10에 매시 백업이 권한 오류로 계속 실패했고 사람이
지켜보다 알았다. 그런데 실패하지 않으면서 쓸모없어지는 길도 있다 — 덤프가 0바이트로 올라가거나, 업로드는
성공했는데 pg_dump가 빈 결과를 냈거나. 복구에 쓰이는 것은 회차의 결론이 아니라 객체 자체이므로 객체를 본다.

왜 판정이 순수 함수인가: 임계와 문구는 R2 없이 검증할 수 있어야 한다. 목록 조회는 호출자가 넣는다.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from .expectations import Violation

__all__ = [
    "BACKUP_EXPECTATIONS",
    "BackupExpectation",
    "BackupObject",
    "ObjectLister",
    "evaluate_backups",
    "judge_backups",
]


@dataclass(frozen=True, slots=True)
class BackupObject:
    """백업 객체 하나에서 이 판정에 필요한 것만 가져온 값이다."""

    key: str
    last_modified: datetime
    size_bytes: int


@dataclass(frozen=True)
class BackupExpectation:
    key: str
    title: str
    runbook: str
    prefix: str
    stale_after: timedelta
    minimum_bytes: int


ObjectLister = Callable[[BackupExpectation], Sequence[BackupObject]]


BACKUP_EXPECTATIONS: tuple[BackupExpectation, ...] = (
    BackupExpectation(
        key="backup-freshness",
        title="마지막 백업이 임계 시간 안에 있다",
        runbook="docs/operations/backup-and-restore.md",
        prefix="backup/postgres/hourly/",
        # 백업은 매시 5분에 돈다. 회차 둘을 놓칠 때까지 기다린다 — 한 회차 지연으로 울리면 재부팅이나
        # 잠깐의 노드 압박에도 알림이 오고, 그러면 사람이 이 알림을 무시하게 된다.
        stale_after=timedelta(hours=3),
        # 손실 허용치(RPO)가 1시간이므로 늦는 것만큼 비어 있는 것도 사고다. 1MiB는 "덤프가 헤더만 남고
        # 잘렸다"를 잡되 정상 크기의 변동에는 걸리지 않는 선이다. 지금 덤프는 GiB 단위다.
        minimum_bytes=1024 * 1024,
    ),
)


def judge_backups(
    expectation: BackupExpectation,
    objects: Sequence[BackupObject],
    *,
    now: datetime,
) -> list[Violation]:
    """가장 최근 객체 하나로 판정한다. 오래됐거나 너무 작으면 위반이다.

    객체가 하나도 없는 것은 위반이다. 워크플로가 한 번도 안 돈 워크플로와 달리, 백업은 이미 돌고 있다고
    선언된 일이라 "없음"이 곧 "복구할 수 없음"이다.
    """
    if not objects:
        return [
            Violation(
                key=f"{expectation.key}:missing",
                title=f"{expectation.title} — 백업 객체가 하나도 없다",
                runbook=expectation.runbook,
                detail=f"prefix={expectation.prefix}",
            )
        ]

    newest = max(objects, key=lambda item: item.last_modified)
    age = now - newest.last_modified
    violations: list[Violation] = []
    if age >= expectation.stale_after:
        hours = int(age.total_seconds() // 3600)
        violations.append(
            Violation(
                key=f"{expectation.key}:stale",
                title=f"{expectation.title} — 마지막 백업이 {hours}시간 전이다",
                runbook=expectation.runbook,
                detail=f"key={newest.key}, 크기={newest.size_bytes}바이트",
            )
        )
    if newest.size_bytes < expectation.minimum_bytes:
        # 신선도와 key를 나눈다. 늦은 것과 비어 있는 것은 원인도 대응도 다르고, 같은 key를 쓰면
        # 상태 파일에서 한쪽이 다른 쪽을 덮어쓴다.
        violations.append(
            Violation(
                key=f"{expectation.key}:too-small",
                title=f"{expectation.title} — 마지막 백업이 너무 작다",
                runbook=expectation.runbook,
                detail=(
                    f"key={newest.key}, 크기={newest.size_bytes}바이트, "
                    f"최소={expectation.minimum_bytes}바이트"
                ),
            )
        )
    return violations


def evaluate_backups(
    list_objects: ObjectLister,
    expectations: Sequence[BackupExpectation] = BACKUP_EXPECTATIONS,
    *,
    now: datetime | None = None,
) -> list[Violation]:
    """각 백업 자리를 조회해 위반만 돌려준다. 조회가 실패하면 그 사실을 위반으로 올린다."""
    moment = now or datetime.now(UTC)
    violations: list[Violation] = []
    for expectation in expectations:
        try:
            objects = list_objects(expectation)
        except Exception as error:  # noqa: BLE001 - 어떤 실패든 사람에게 알린다
            violations.append(
                Violation(
                    key=f"{expectation.key}:check-failed",
                    title=f"기대 '{expectation.title}'를 평가하지 못했다",
                    runbook=expectation.runbook,
                    detail=f"{type(error).__name__}: {error}",
                )
            )
            continue
        violations.extend(judge_backups(expectation, objects, now=moment))
    return violations
