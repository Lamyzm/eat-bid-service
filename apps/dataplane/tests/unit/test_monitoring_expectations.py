"""모듈 책임: 기대 판정과 반복 알림 억제가 DB 없이도 규칙대로 동작하는지 고정한다."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

from eatbid.monitoring.expectations import (
    EXPECTATIONS,
    Expectation,
    Violation,
    evaluate,
)
from eatbid.monitoring.ledger import AppliedDiff
from eatbid.monitoring.notify import format_message, format_resolution
from eatbid.monitoring.round import RoundMetrics
from eatbid.monitoring.runner import run_expectation_check
from eatbid.monitoring.state import (
    OpenViolation,
    decode_state,
    diff_violations,
    encode_state,
)

_기대_하나 = Expectation(
    key="probe",
    title="탐침이 진행하고 있다",
    runbook="docs/operations/collection-runbook.md#4-capturenormalize-단계가-죽은-실행-복구-2026-09-10-eat-122",
    sql="select 1",
    parameters={},
)


def _응답(rows: Sequence[Mapping[str, Any]]):
    def run_query(
        _sql: str, _parameters: Mapping[str, Any]
    ) -> Sequence[Mapping[str, Any]]:
        return rows

    return run_query


def test_행이_없으면_기대는_만족한_것으로_본다() -> None:
    assert evaluate(_응답([]), [_기대_하나]) == []


def test_돌아온_행마다_대응_문서를_붙인_위반을_만든다() -> None:
    위반들 = evaluate(
        _응답([{"run_id": "r1", "last_progress_at": "2026-09-10T09:00:00Z"}]),
        [_기대_하나],
    )

    assert len(위반들) == 1
    assert 위반들[0].key == "probe"
    assert "run_id=r1" in 위반들[0].detail
    assert 위반들[0].runbook == _기대_하나.runbook


def test_여러_행이_나오면_행마다_다른_key를_준다() -> None:
    # 같은 key를 쓰면 상태 파일이 key로 집합을 만들므로 한 행이 다른 행을 덮는다. 2026-09-06부터
    # `running`으로 남은 reference run 하나가 실제로 이틀 동안 backfill 멈춤 감시를 눈멀게 했다.
    기대 = Expectation(
        key="probe",
        title="탐침이 진행하고 있다",
        runbook="docs/operations/collection-runbook.md",
        sql="select 1",
        parameters={},
        key_columns=("run_id",),
    )

    위반들 = evaluate(_응답([{"run_id": "r1"}, {"run_id": "r2"}]), [기대])

    assert sorted(v.key for v in 위반들) == ["probe:r1", "probe:r2"]


def test_가르는_컬럼을_선언하지_않으면_기대_key를_그대로_쓴다() -> None:
    위반들 = evaluate(_응답([{"count": 3}]), [_기대_하나])

    assert [v.key for v in 위반들] == ["probe"]


def test_가르는_컬럼이_결과에_없으면_unknown으로_채운다() -> None:
    # 질의를 잘못 적었다는 이유로 감시를 멈추는 것보다 덜 알리는 쪽이 낫다.
    기대 = Expectation(
        key="probe",
        title="탐침이 진행하고 있다",
        runbook="docs/operations/collection-runbook.md",
        sql="select 1",
        parameters={},
        key_columns=("run_id",),
    )

    위반들 = evaluate(_응답([{"다른컬럼": 1}]), [기대])

    assert [v.key for v in 위반들] == ["probe:unknown"]


def test_상태_문서는_알림_문구를_그대로_들고_있는다() -> None:
    # 문구가 텔레그램에만 있으면 지금 무엇이 잘못됐는지는 그 방을 본 사람만 안다.
    차이 = diff_violations(
        [Violation(key="probe", title="제목", runbook="docs/x.md", detail="run_id=r1")],
        [],
        now="2026-09-16T00:00:00Z",
    )

    문서 = encode_state(차이.still_open, now="2026-09-16T00:00:00Z")

    assert 문서["open"] == [
        {
            "key": "probe",
            "first_seen_at": "2026-09-16T00:00:00Z",
            "title": "제목",
            "detail": "run_id=r1",
            "runbook": "docs/x.md",
            "observation": "observed",
        }
    ]


def test_문구가_없던_옛_문서도_읽는다() -> None:
    # 이 필드를 더하기 전에 쓰인 문서가 R2에 남아 있다. 그것 때문에 열려 있던 위반이 전부 "새로 열림"으로
    # 다시 알려지면 안 된다.
    복원 = decode_state(
        {"open": [{"key": "probe", "first_seen_at": "2026-09-12T20:18:10Z"}]}
    )

    assert [item.key for item in 복원] == ["probe"]
    assert 복원[0].first_seen_at == "2026-09-12T20:18:10Z"
    assert 복원[0].title == ""


def test_질의가_실패하면_조용히_넘기지_않고_위반으로_올린다() -> None:
    def 터지는_질의(_sql: str, _parameters: Mapping[str, Any]):
        raise RuntimeError("연결이 끊겼다")

    위반들 = evaluate(터지는_질의, [_기대_하나])

    assert len(위반들) == 1
    assert 위반들[0].key == "probe:check-failed"
    assert "RuntimeError" in 위반들[0].detail


def test_선언된_기대는_모두_고유한_key와_대응_문서를_갖는다() -> None:
    keys = [기대.key for 기대 in EXPECTATIONS]

    assert len(keys) == len(set(keys))
    assert all(기대.runbook.startswith("docs/") for 기대 in EXPECTATIONS)
    assert all(기대.title for 기대 in EXPECTATIONS)


def test_이미_열려_있는_위반은_다시_보내지_않는다() -> None:
    현재 = [Violation(key="probe", title="t", runbook="docs/x.md", detail="d")]
    이전 = [OpenViolation(key="probe", first_seen_at="2026-09-10T00:00:00Z")]

    결과 = diff_violations(현재, 이전, now="2026-09-11T00:00:00Z")

    assert 결과.opened == ()
    assert 결과.resolved == ()
    assert [item.key for item in 결과.still_open] == ["probe"]
    assert 결과.still_open[0].first_seen_at == "2026-09-10T00:00:00Z"


def test_사라진_위반은_해소로_보고하고_새_위반만_새로_보낸다() -> None:
    현재 = [Violation(key="새것", title="t", runbook="docs/x.md", detail="d")]
    이전 = [OpenViolation(key="옛것", first_seen_at="2026-09-10T00:00:00Z")]

    결과 = diff_violations(현재, 이전, now="2026-09-11T00:00:00Z")

    assert [violation.key for violation in 결과.opened] == ["새것"]
    assert 결과.resolved == ("옛것",)


def test_기대_평가에_실패한_회차는_그_기대의_열린_위반을_해소하지_않는다() -> None:
    """질의가 예외로 끝나면 그 기대의 위반 행은 이번 회차에 하나도 없다. 그것은 사라진 것이 아니라
    모르는 것이다(2026-09-16 코드 확인, EAT-242). 해소로 판정하면 "해소됨"이 나가고 다음 회차에 같은 위반이
    새로 열린 것으로 first_seen_at이 초기화된다."""
    현재 = [
        Violation(
            key="probe:check-failed",
            title="기대 'probe'를 평가하지 못했다",
            runbook="docs/x.md",
            detail="OperationalError: 연결 끊김",
        )
    ]
    이전 = [
        OpenViolation(
            key="probe:r1",
            first_seen_at="2026-09-10T00:00:00Z",
            title="탐침이 진행하고 있다",
            detail="run=r1",
        ),
        OpenViolation(key="probe", first_seen_at="2026-09-09T00:00:00Z"),
    ]

    결과 = diff_violations(현재, 이전, now="2026-09-11T00:00:00Z")

    assert 결과.resolved == ()
    assert [violation.key for violation in 결과.opened] == ["probe:check-failed"]
    남은 = {item.key: item for item in 결과.still_open}
    assert set(남은) == {"probe:check-failed", "probe:r1", "probe"}
    assert 남은["probe:r1"].first_seen_at == "2026-09-10T00:00:00Z"
    assert 남은["probe:r1"].observation == "unobserved"
    assert 남은["probe:r1"].detail == "run=r1"
    assert 남은["probe"].observation == "unobserved"
    assert 남은["probe:check-failed"].observation == "observed"


def test_다른_기대의_위반_해소는_평가_실패와_무관하게_판정된다() -> None:
    현재 = [
        Violation(key="probe:check-failed", title="t", runbook="docs/x.md", detail="d")
    ]
    이전 = [
        OpenViolation(key="probe:r1", first_seen_at="2026-09-10T00:00:00Z"),
        OpenViolation(key="other:x", first_seen_at="2026-09-10T00:00:00Z"),
        # 접두사가 겹쳐 보이는 다른 기대다. `probe`의 실패가 `probe-two`를 덮어쓰면 안 된다.
        OpenViolation(key="probe-two:y", first_seen_at="2026-09-10T00:00:00Z"),
    ]

    결과 = diff_violations(현재, 이전, now="2026-09-11T00:00:00Z")

    assert sorted(결과.resolved) == ["other:x", "probe-two:y"]
    assert "probe:r1" in {item.key for item in 결과.still_open}


def test_관측_안_됨으로_남은_위반은_회복된_회차에_first_seen_at을_이어간다() -> None:
    첫_회차 = diff_violations(
        [
            Violation(
                key="probe:check-failed", title="t", runbook="docs/x.md", detail="d"
            )
        ],
        [OpenViolation(key="probe:r1", first_seen_at="2026-09-10T00:00:00Z")],
        now="2026-09-11T00:00:00Z",
    )
    회복 = diff_violations(
        [Violation(key="probe:r1", title="t", runbook="docs/x.md", detail="d")],
        첫_회차.still_open,
        now="2026-09-11T00:15:00Z",
    )

    assert 회복.opened == ()
    assert 회복.resolved == ("probe:check-failed",)
    assert [
        (item.key, item.first_seen_at, item.observation) for item in 회복.still_open
    ] == [("probe:r1", "2026-09-10T00:00:00Z", "observed")]


def test_평가_실패_자체가_풀리면_그_위반만_해소된다() -> None:
    결과 = diff_violations(
        [],
        [OpenViolation(key="probe:check-failed", first_seen_at="2026-09-11T00:00:00Z")],
        now="2026-09-11T00:15:00Z",
    )

    assert 결과.resolved == ("probe:check-failed",)
    assert 결과.still_open == ()


def test_observation이_없는_옛_상태_문서는_관측된_것으로_읽는다() -> None:
    복원 = decode_state({"open": [{"key": "probe", "first_seen_at": "t"}]})

    assert 복원[0].observation == "observed"


def test_저장된_상태가_깨져_있으면_빈_것으로_읽어_검사를_멈추지_않는다() -> None:
    assert decode_state(None) == ()
    assert decode_state({"open": "목록이 아님"}) == ()
    assert decode_state({"open": [{"key": 1, "first_seen_at": "t"}]}) == ()


def test_상태는_읽은_그대로_다시_쓸_수_있다() -> None:
    원본 = (OpenViolation(key="probe", first_seen_at="2026-09-10T00:00:00Z"),)

    다시 = decode_state(encode_state(원본, now="2026-09-11T00:00:00Z"))

    assert 다시 == 원본


def test_여러_위반은_한_덩어리_문구로_묶어_하나의_사고로_읽히게_한다() -> None:
    위반들 = [
        Violation(key="a", title="첫째가 멈췄다", runbook="docs/a.md", detail="x=1"),
        Violation(key="b", title="둘째가 멈췄다", runbook="docs/b.md", detail="y=2"),
    ]

    문구 = format_message("prod", 위반들)

    assert 문구.startswith("[prod] 운영 기대 위반 2건")
    assert "첫째가 멈췄다" in 문구 and "둘째가 멈췄다" in 문구
    assert "대응: docs/a.md" in 문구


def test_문구가_텔레그램_상한을_넘으면_잘렸다는_사실을_남긴다() -> None:
    위반들 = [
        Violation(
            key=f"k{index}", title="긴 제목" * 40, runbook="docs/a.md", detail="d" * 200
        )
        for index in range(40)
    ]

    문구 = format_message("prod", 위반들)

    assert len(문구) <= 4096
    assert 문구.endswith("(길이 제한으로 잘림)")


def test_해소_문구는_환경과_해소된_key를_함께_적는다() -> None:
    assert format_resolution("dev", ["a", "b"]) == "[dev] 해소됨: a, b"


class _기억하는_원장:
    """표 대신 메모리에 같은 규칙으로 적는 원장. runner가 표에 무엇을 요구하는지가 이 클래스에 드러난다."""

    def __init__(self) -> None:
        self.rows: dict[int, OpenViolation] = {}
        self.resolved: dict[str, int] = {}
        self.notifications: list[tuple[str, tuple[int | None, ...], bool]] = []
        self.digests_sent_at: list[datetime] = []
        self._next = 1

    def read_open(self) -> tuple[OpenViolation, ...]:
        return tuple(self.rows.values())

    def apply(self, diff, *, now: datetime) -> AppliedDiff:
        opened = {v.key for v in diff.opened}
        still: list[OpenViolation] = []
        for item in diff.still_open:
            if item.key in opened:
                item = replace(item, violation_id=self._next)
                self._next += 1
            assert item.violation_id is not None
            self.rows[item.violation_id] = item
            still.append(item)
        resolved_ids: dict[str, int] = {}
        for key in diff.resolved:
            for violation_id, row in list(self.rows.items()):
                if row.key == key:
                    del self.rows[violation_id]
                    resolved_ids[key] = violation_id
        self.resolved.update(resolved_ids)
        return AppliedDiff(still_open=tuple(still), resolved_ids=resolved_ids)

    def mark_notified(self, violation_ids, *, at: datetime) -> None:
        for violation_id in violation_ids:
            self.rows[violation_id] = replace(
                self.rows[violation_id], last_notified_at=at.isoformat()
            )

    def record_notification(self, *, kind, violation_ids, sent_at, ok, error) -> None:
        self.notifications.append((kind, tuple(violation_ids), ok))
        if kind == "digest" and ok:
            self.digests_sent_at.append(sent_at)

    def digest_sent_since(self, since: datetime) -> bool:
        # 표와 같은 규칙: 그날 자정 이후에 보낸 요약이 있는가. 어제 보낸 것은 오늘을 막지 않는다.
        return any(sent_at >= since for sent_at in self.digests_sent_at)


_정오 = datetime(2026, 9, 16, 3, 0, tzinfo=UTC)  # 12:00 KST — 요약 시각이 아니다


def test_한_회차는_새_위반만_알리고_다음_회차는_침묵한다() -> None:
    보낸것: list[str] = []
    원장 = _기억하는_원장()

    첫회차 = run_expectation_check(
        run_query=_응답([{"run_id": "r1"}]),
        ledger=원장,
        notify=보낸것.append,
        environment="prod",
        expectations=[_기대_하나],
        now=_정오,
    )
    둘째회차 = run_expectation_check(
        run_query=_응답([{"run_id": "r1"}]),
        ledger=원장,
        notify=보낸것.append,
        environment="prod",
        expectations=[_기대_하나],
        now=_정오 + timedelta(minutes=15),
    )

    assert 첫회차.opened == ("probe",)
    assert 둘째회차.opened == ()
    assert len(보낸것) == 1
    assert [kind for kind, _, _ in 원장.notifications] == ["opened"]


def test_위반이_사라지면_해소를_한_번_알린다() -> None:
    보낸것: list[str] = []
    원장 = _기억하는_원장()

    run_expectation_check(
        run_query=_응답([{"run_id": "r1"}]),
        ledger=원장,
        notify=보낸것.append,
        environment="prod",
        expectations=[_기대_하나],
        now=_정오,
    )
    회차 = run_expectation_check(
        run_query=_응답([]),
        ledger=원장,
        notify=보낸것.append,
        environment="prod",
        expectations=[_기대_하나],
        now=_정오 + timedelta(minutes=15),
    )

    assert 회차.resolved == ("probe",)
    assert 보낸것[-1].startswith("[prod] 해소됨: probe")
    assert 원장.notifications[-1] == ("resolved", (1,), True)


def test_미해결_critical은_간격이_지나면_다시_알리고_normal은_침묵한다() -> None:
    """ "묶기"와 "재알림"은 별개다(ADR 0054 결정 1). 첫 통을 놓친 사람에게 critical은 60분 뒤 다시 말한다."""
    보낸것: list[str] = []
    원장 = _기억하는_원장()
    critical = Expectation(
        key="live",
        title="실시간 수집이 돈다",
        runbook="docs/x.md",
        sql="select 1",
        parameters={},
        severity="critical",
    )

    run_expectation_check(
        run_query=_응답([{"count": 1}]),
        ledger=원장,
        notify=보낸것.append,
        environment="prod",
        expectations=[critical, _기대_하나],
        now=_정오,
    )
    조용한_회차 = run_expectation_check(
        run_query=_응답([{"count": 1}]),
        ledger=원장,
        notify=보낸것.append,
        environment="prod",
        expectations=[critical, _기대_하나],
        now=_정오 + timedelta(minutes=30),
    )
    다시_우는_회차 = run_expectation_check(
        run_query=_응답([{"count": 1}]),
        ledger=원장,
        notify=보낸것.append,
        environment="prod",
        expectations=[critical, _기대_하나],
        now=_정오 + timedelta(minutes=61),
    )

    assert 조용한_회차.repeated == ()
    assert 다시_우는_회차.repeated == ("live",)
    assert 보낸것[-1].startswith("[prod] 미해결 1건 (다시 알림)")
    assert "1시간째" in 보낸것[-1]
    assert "probe" not in 보낸것[-1]
    assert len(보낸것) == 2


def test_아침_요약은_그날_첫_9시_회차에_한_번만_나가고_열린_것_전부와_나이를_적는다() -> (
    None
):
    보낸것: list[str] = []
    원장 = _기억하는_원장()
    아침 = datetime(2026, 9, 17, 0, 3, tzinfo=UTC)  # 09:03 KST

    run_expectation_check(
        run_query=_응답([{"run_id": "r1"}]),
        ledger=원장,
        notify=보낸것.append,
        environment="prod",
        expectations=[_기대_하나],
        now=아침 - timedelta(days=5),
    )
    첫_아침_회차 = run_expectation_check(
        run_query=_응답([{"run_id": "r1"}]),
        ledger=원장,
        notify=보낸것.append,
        environment="prod",
        expectations=[_기대_하나],
        now=아침,
    )
    같은_아침_다음_회차 = run_expectation_check(
        run_query=_응답([{"run_id": "r1"}]),
        ledger=원장,
        notify=보낸것.append,
        environment="prod",
        expectations=[_기대_하나],
        now=아침 + timedelta(minutes=15),
    )

    assert 첫_아침_회차.digest_sent is True
    assert 같은_아침_다음_회차.digest_sent is False
    assert 보낸것[-1].startswith(
        "[prod] 아침 요약: 열린 위반 1건, 가장 오래된 것 5일째 (probe)"
    )
    assert "[normal] probe" in 보낸것[-1]
    assert 원장.notifications[-1] == ("digest", (), True)


def test_전송이_실패하면_실패_행을_남기고_회차를_실패로_끝낸다() -> None:
    원장 = _기억하는_원장()

    def 막힌_전송(_: str) -> None:
        raise RuntimeError("텔레그램 503")

    with pytest.raises(RuntimeError):
        run_expectation_check(
            run_query=_응답([{"run_id": "r1"}]),
            ledger=원장,
            notify=막힌_전송,
            environment="prod",
            expectations=[_기대_하나],
            now=_정오,
        )

    assert 원장.notifications == [("opened", (1,), False)]


def test_판정과_알림이_끝난_뒤_지표_한_행을_기록자에게_넘긴다() -> None:
    """지표는 알림의 근거가 아니다(ADR 0046 결정 4). 그래서 열린 위반 수와 걸린 시간은 판정이 끝난
    값이고, 기록자가 없으면 회차는 지표 없이도 완전하다."""
    기록: list[RoundMetrics] = []
    순서: list[str] = []
    시계 = iter([10.0, 10.25])

    def run_query(
        sql: str, parameters: Mapping[str, Any]
    ) -> Sequence[Mapping[str, Any]]:
        return [{"run_id": "r1"}] if sql == _기대_하나.sql else []

    def record(metrics: RoundMetrics) -> None:
        순서.append("round")
        기록.append(metrics)

    회차 = run_expectation_check(
        run_query=run_query,
        ledger=_기억하는_원장(),
        notify=lambda _: 순서.append("notify"),
        environment="prod",
        expectations=[_기대_하나],
        record_round=record,
        clock=lambda: next(시계),
        now=_정오,
    )

    assert 회차.round_recorded is True
    assert 순서 == ["notify", "round"]
    assert (
        기록[0].environment,
        기록[0].violations_open,
        기록[0].check_duration_ms,
    ) == ("prod", 1, 250)
    assert (기록[0].runs_started_1h, 기록[0].auctions_published_1h) == ({}, 0)


def test_기록자가_없으면_지표_없이_회차가_끝난다() -> None:
    회차 = run_expectation_check(
        run_query=_응답([]),
        ledger=_기억하는_원장(),
        notify=lambda _: None,
        environment="prod",
        expectations=[_기대_하나],
        now=_정오,
    )

    assert 회차.round_recorded is False
