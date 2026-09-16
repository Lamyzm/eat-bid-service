"""모듈 책임: 이미 받아 둔 raw 관측에 지금 파서를 쓰지 않고 돌려 계약 빈틈(격리 사유)을 한 번에 모은다.

왜 필요한가: 3월 창은 음수 사정률(ADR 0053), 2025-09 창은 음수 투찰금액(EAT-246)으로 막혔다. 같은 부류가 달마다
하나씩 나오면 달마다 ADR·릴리스·replay를 반복한다. R2 raw는 불변이고 파서는 결정적이므로(ADR 0014) 소스 호출
없이 재파싱만으로 남은 빈틈을 미리 볼 수 있다(EAT-251).

왜 쓰지 않는가: 이것은 실제 정규화 시도가 아니다. `ingest.normalization_attempt`에 남기면 replay 이력과 섞여
"몇 번 시도했나"가 거짓이 된다. 결과는 보고서 하나이고 판정은 호출자가 한다.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from datetime import datetime
from hashlib import sha256
from typing import Any

from eatbid.source.eat.normalize import (
    EatDetailValidationError,
    normalize_bid_detail_payload,
)
from eatbid.source.eat.xml import NexacroParseError

SAMPLE_LIMIT = 5


@dataclass(frozen=True)
class ScanCandidate:
    observation_id: int
    object_key: str
    content_sha256: str
    external_bid_id: str


@dataclass
class ReasonBucket:
    count: int = 0
    sample_bid_ids: list[str] = field(default_factory=list)

    def add(self, external_bid_id: str) -> None:
        self.count += 1
        if (
            len(self.sample_bid_ids) < SAMPLE_LIMIT
            and external_bid_id not in self.sample_bid_ids
        ):
            self.sample_bid_ids.append(external_bid_id)


@dataclass
class ScanReport:
    parser_version: str
    started_at: datetime
    scanned: int = 0
    ok: int = 0
    quarantined: int = 0
    integrity_failures: int = 0
    reasons: dict[str, ReasonBucket] = field(default_factory=dict)
    finished_at: datetime | None = None

    def to_document(self) -> dict[str, Any]:
        """사람이 읽고 다음 ADR이 인용하는 모양. 사유별 건수는 많은 순이다."""
        ordered = sorted(
            self.reasons.items(), key=lambda item: (-item[1].count, item[0])
        )
        return {
            "parser_version": self.parser_version,
            "started_at": self.started_at.isoformat(),
            "finished_at": self.finished_at.isoformat() if self.finished_at else None,
            "scanned": self.scanned,
            "ok": self.ok,
            "quarantined": self.quarantined,
            "integrity_failures": self.integrity_failures,
            "reasons": [
                {
                    "reason": reason,
                    "count": bucket.count,
                    "sample_bid_ids": list(bucket.sample_bid_ids),
                }
                for reason, bucket in ordered
            ],
        }


Normalizer = Callable[..., Any]


def scan_candidates(
    candidates: Iterable[ScanCandidate],
    *,
    read_raw: Callable[[str], bytes],
    parser_version: str,
    now: datetime,
    normalize: Normalizer = normalize_bid_detail_payload,
    on_progress: Callable[[ScanReport], None] | None = None,
) -> ScanReport:
    """관측마다 raw를 읽어 파서만 돌린다. 격리 사유는 문자열 그대로 묶는다 — 실제 정규화가 남기는 사유와 같은 문장이라
    이 보고서의 한 줄이 곧 `normalization_attempt.quarantine_reason` 한 부류다.

    파싱·검증 예외만 잡는다. 그 밖의 예외(설정, 알 수 없는 parser version, R2 장애)는 조사 결과가 아니라 조사의
    실패이므로 그대로 올린다.
    """
    report = ScanReport(parser_version=parser_version, started_at=now)
    for candidate in candidates:
        raw = read_raw(candidate.object_key)
        report.scanned += 1
        if sha256(raw).hexdigest() != candidate.content_sha256:
            report.integrity_failures += 1
            report.reasons.setdefault(
                "(integrity) restored raw bytes do not match content_sha256",
                ReasonBucket(),
            ).add(candidate.external_bid_id)
            continue
        try:
            normalize(
                raw,
                external_bid_id=candidate.external_bid_id,
                parser_version=parser_version,
            )
        except (NexacroParseError, EatDetailValidationError) as error:
            report.quarantined += 1
            report.reasons.setdefault(str(error), ReasonBucket()).add(
                candidate.external_bid_id
            )
        else:
            report.ok += 1
        if on_progress is not None and report.scanned % 1000 == 0:
            on_progress(report)
    return report
