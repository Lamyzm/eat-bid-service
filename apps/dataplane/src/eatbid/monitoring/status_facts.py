"""모듈 책임: 상태 보고 한 통이 담는 사실의 모양(구획별 값과 "확인 못 함")을 선언한다.

왜 `Unavailable`이 따로 있는가: 질의가 실패했거나 권한이 없어 모르는 값을 0이나 정상으로 적으면, 감시가 눈먼
날 보고가 가장 조용해진다(AGENTS.md 3항). 모르는 값은 모으는 쪽(status_collect)에서 조립하는 쪽(status_report)
까지 끝까지 "확인 못 함"으로 간다.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta

from .report_schedule import ReportSlot
from .state import OpenViolation


@dataclass(frozen=True)
class Unavailable:
    reason: str

    def __str__(self) -> str:
        return f"확인 못 함({self.reason})"


@dataclass(frozen=True)
class ReconcileFacts:
    status: str
    started_at: datetime
    ended_at: datetime | None
    published: int


@dataclass(frozen=True)
class CrawlerFacts:
    planned: int
    started: int
    succeeded: int
    failed: int
    running: int
    published: int
    excluded: int
    last_success_at: datetime | None
    average_duration: timedelta | None
    longest_duration: timedelta | None
    reconcile: ReconcileFacts | None

    @property
    def skipped(self) -> int:
        """계획 대비 실행 부족분. concurrencyPolicy: Forbid는 앞 회차가 길면 겹친 예약을 기록 없이 건너뛴다."""
        return max(self.planned - self.started, 0)


@dataclass(frozen=True)
class PublicationFacts:
    stale_validated: int
    backfill_complete: int
    backfill_total: int
    unresolved_exclusions: int
    unresolved_windows: int


@dataclass(frozen=True)
class WorkloadFacts:
    name: str
    ready: int
    desired: int
    restarts: int
    last_restart_at: datetime | None
    # HTTP 상태 코드 또는 모름. 파드가 Ready여도 응답이 틀릴 수 있어 둘을 따로 본다.
    http_status: int | Unavailable


@dataclass(frozen=True)
class DatabaseFacts:
    size_bytes: int | Unavailable
    volume_bytes: int | Unavailable
    last_backup_at: datetime | None | Unavailable


@dataclass(frozen=True)
class ApplicationFacts:
    name: str
    sync: str
    health: str
    revision: str | None
    images: tuple[str, ...]


@dataclass(frozen=True)
class StatusReport:
    environment: str
    slot: ReportSlot
    now: datetime
    crawler: CrawlerFacts | Unavailable
    publication: PublicationFacts | Unavailable
    backend: tuple[WorkloadFacts, ...] | Unavailable
    database: DatabaseFacts
    deploy: tuple[ApplicationFacts, ...] | Unavailable
    problems: tuple[OpenViolation, ...]


def _reason(error: Exception) -> str:
    text = f"{type(error).__name__}: {error}"
    return text if len(text) <= 120 else text[:117] + "…"


def attempt[T](read: Callable[[], T]) -> T | Unavailable:
    """읽기 하나를 감싼다. 어떤 실패든 이유를 단 "확인 못 함"이 되고, 다른 구획의 읽기를 막지 않는다."""
    try:
        return read()
    except Exception as error:  # noqa: BLE001 - 어떤 실패든 "확인 못 함"으로 보고에 남긴다
        return Unavailable(_reason(error))
