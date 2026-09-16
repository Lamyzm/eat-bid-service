"""모듈 책임: 위반의 수명과 보낸 알림을 `monitoring.violation`·`monitoring.notification`에 적고 읽는 SQL을 소유한다.

왜 표인가: 열린 위반 목록이 R2 JSON에만 있을 때 PostgreSQL을 보는 Grafana도 psql을 쓰는 에이전트도 그것을 읽지
못했고, 그 사이 `ci-main-green` 위반이 5일 동안 억제된 채 방치됐다(ADR 0054 결정 2). 나이·이력·재알림 판정은
사람과 기계가 같이 읽는 표에서 나야 한다.

왜 I/O를 주입받는가: 판정(state.diff_violations)은 순수 함수로 남고, 이 모듈은 그 결과를 표에 옮기는 일만 한다.
연결과 commit은 조립부의 것이다.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import datetime
from typing import Any

from .state import OBSERVED, UNOBSERVED, OpenViolation, ViolationDiff

Query = Callable[[str, Mapping[str, Any]], Sequence[Mapping[str, Any]]]
"""읽기. commit하지 않는다."""

Mutate = Callable[[str, Mapping[str, Any]], Sequence[Mapping[str, Any]]]
"""쓰기. 실행 뒤 commit하고 `returning` 행이 있으면 돌려준다."""


@dataclass(frozen=True)
class AppliedDiff:
    """표에 옮긴 뒤의 상태. 열린 위반은 전부 `violation_id`를 갖고, 해소된 위반은 key→id로 남는다."""

    still_open: tuple[OpenViolation, ...]
    resolved_ids: Mapping[str, int]


_READ_OPEN = """
    select violation_id, violation_key, severity, title, detail, runbook,
           first_seen_at, observation, last_notified_at
      from monitoring.violation
     where environment = %(environment)s and resolved_at is null
     order by first_seen_at
"""

_INSERT = """
    insert into monitoring.violation (
        environment, violation_key, expectation_key, severity, title, detail, runbook,
        first_seen_at, last_seen_at, observation, last_notified_at
    ) values (
        %(environment)s, %(violation_key)s, %(expectation_key)s, %(severity)s, %(title)s, %(detail)s, %(runbook)s,
        %(first_seen_at)s, %(last_seen_at)s, %(observation)s, %(last_notified_at)s
    )
    returning violation_id
"""

_TOUCH_OBSERVED = """
    update monitoring.violation
       set last_seen_at = %(now)s, observation = %(observed)s, severity = %(severity)s,
           title = %(title)s, detail = %(detail)s, runbook = %(runbook)s
     where violation_id = %(violation_id)s
"""

_TOUCH_UNOBSERVED = """
    update monitoring.violation set observation = %(unobserved)s where violation_id = %(violation_id)s
"""

_RESOLVE = """
    update monitoring.violation set resolved_at = %(now)s where violation_id = %(violation_id)s
"""

_MARK_NOTIFIED = """
    update monitoring.violation set last_notified_at = %(at)s where violation_id = any(%(ids)s)
"""

_RECORD = """
    insert into monitoring.notification (environment, violation_id, kind, sent_at, ok, error)
    values (%(environment)s, %(violation_id)s, %(kind)s, %(sent_at)s, %(ok)s, %(error)s)
"""

_DIGEST_SINCE = """
    select count(*) as sent
      from monitoring.notification
     where environment = %(environment)s and kind = 'digest' and ok and sent_at >= %(since)s
"""

_COUNT_ALL = "select count(*) as total from monitoring.violation where environment = %(environment)s"


class PostgresViolationLedger:
    def __init__(self, *, query: Query, mutate: Mutate, environment: str) -> None:
        self._query = query
        self._mutate = mutate
        self._environment = environment

    def read_open(self) -> tuple[OpenViolation, ...]:
        rows = self._query(_READ_OPEN, {"environment": self._environment})
        return tuple(
            OpenViolation(
                key=str(row["violation_key"]),
                first_seen_at=_iso(row["first_seen_at"]),
                title=str(row["title"]),
                detail=str(row["detail"]),
                runbook=str(row["runbook"]),
                observation=str(row["observation"]),
                severity=str(row["severity"]),
                last_notified_at=(
                    _iso(row["last_notified_at"])
                    if row["last_notified_at"] is not None
                    else None
                ),
                violation_id=int(row["violation_id"]),
            )
            for row in rows
        )

    def apply(self, diff: ViolationDiff, *, now: datetime) -> AppliedDiff:
        """판정 결과를 표에 옮긴다. 새로 열린 것은 insert, 관측된 것은 갱신, 관측 안 된 것은 표시만, 해소는 시각만."""
        opened_keys = {violation.key for violation in diff.opened}
        still_open: list[OpenViolation] = []
        for item in diff.still_open:
            if item.key in opened_keys:
                rows = self._mutate(
                    _INSERT,
                    {
                        "environment": self._environment,
                        "violation_key": item.key,
                        "expectation_key": item.expectation_key,
                        "severity": item.severity,
                        "title": item.title,
                        "detail": item.detail,
                        "runbook": item.runbook,
                        "first_seen_at": now,
                        "last_seen_at": now,
                        "observation": OBSERVED,
                        "last_notified_at": None,
                    },
                )
                still_open.append(
                    replace(item, violation_id=int(rows[0]["violation_id"]))
                )
                continue
            if item.violation_id is None:
                # 표에 없던 열린 위반이 관측·비관측으로 들어올 수는 없다. 그렇다면 읽기와 판정 사이에 표가
                # 바뀐 것이고, 조용히 넘기면 그 위반은 영원히 표 밖에 남는다.
                raise RuntimeError(f"열린 위반에 violation_id가 없습니다: {item.key}")
            if item.observation == UNOBSERVED:
                self._mutate(
                    _TOUCH_UNOBSERVED,
                    {"unobserved": UNOBSERVED, "violation_id": item.violation_id},
                )
            else:
                self._mutate(
                    _TOUCH_OBSERVED,
                    {
                        "now": now,
                        "observed": OBSERVED,
                        "severity": item.severity,
                        "title": item.title,
                        "detail": item.detail,
                        "runbook": item.runbook,
                        "violation_id": item.violation_id,
                    },
                )
            still_open.append(item)

        resolved_ids: dict[str, int] = {}
        previous_ids = {item.key: item.violation_id for item in self.read_open()}
        for key in diff.resolved:
            violation_id = previous_ids.get(key)
            if violation_id is None:
                continue
            self._mutate(_RESOLVE, {"now": now, "violation_id": violation_id})
            resolved_ids[key] = violation_id
        return AppliedDiff(still_open=tuple(still_open), resolved_ids=resolved_ids)

    def mark_notified(self, violation_ids: Sequence[int], *, at: datetime) -> None:
        if violation_ids:
            self._mutate(_MARK_NOTIFIED, {"at": at, "ids": list(violation_ids)})

    def record_notification(
        self,
        *,
        kind: str,
        violation_ids: Sequence[int | None],
        sent_at: datetime,
        ok: bool,
        error: str | None,
    ) -> None:
        """보낸(또는 보내려 한) 통 하나를 위반 하나당 한 행으로 남긴다. 요약은 violation_id 없이 한 행이다."""
        for violation_id in violation_ids or (None,):
            self._mutate(
                _RECORD,
                {
                    "environment": self._environment,
                    "violation_id": violation_id,
                    "kind": kind,
                    "sent_at": sent_at,
                    "ok": ok,
                    "error": error,
                },
            )

    def digest_sent_since(self, since: datetime) -> bool:
        rows = self._query(
            _DIGEST_SINCE, {"environment": self._environment, "since": since}
        )
        return bool(rows) and int(rows[0]["sent"]) > 0

    def is_empty(self) -> bool:
        rows = self._query(_COUNT_ALL, {"environment": self._environment})
        return not rows or int(rows[0]["total"]) == 0

    def import_open(self, items: Sequence[OpenViolation], *, now: datetime) -> int:
        """R2 문서 시절의 열린 위반을 아는 값만 옮긴다(ADR 0054 결정 3). 첫 통은 그때 나갔으므로
        last_notified_at은 first_seen_at으로 둔다. 없는 이력은 만들지 않는다."""
        for item in items:
            first_seen = _parse(item.first_seen_at)
            self._mutate(
                _INSERT,
                {
                    "environment": self._environment,
                    "violation_key": item.key,
                    "expectation_key": item.expectation_key,
                    "severity": item.severity,
                    "title": item.title,
                    "detail": item.detail,
                    "runbook": item.runbook,
                    "first_seen_at": first_seen,
                    "last_seen_at": now,
                    "observation": item.observation,
                    "last_notified_at": first_seen,
                },
            )
        return len(items)


def _iso(value: Any) -> str:
    return value.isoformat() if isinstance(value, datetime) else str(value)


def _parse(text: str) -> datetime:
    from .notify import parse_instant

    return parse_instant(text)
