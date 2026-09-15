"""모듈 책임: 기대 판정과 반복 알림 억제가 DB 없이도 규칙대로 동작하는지 고정한다."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from eatbid.monitoring.expectations import (
    EXPECTATIONS,
    Expectation,
    Violation,
    evaluate,
)
from eatbid.monitoring.notify import format_message, format_resolution
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


class _기억하는_저장소:
    def __init__(self, document: dict[str, Any] | None = None) -> None:
        self.document = document

    def read(self) -> dict[str, Any] | None:
        return self.document

    def write(self, document: Mapping[str, Any]) -> None:
        self.document = dict(document)


def test_한_회차는_새_위반만_알리고_다음_회차는_침묵한다() -> None:
    보낸것: list[str] = []
    저장소 = _기억하는_저장소()

    첫회차 = run_expectation_check(
        run_query=_응답([{"run_id": "r1"}]),
        state_store=저장소,
        notify=보낸것.append,
        environment="prod",
        expectations=[_기대_하나],
    )
    둘째회차 = run_expectation_check(
        run_query=_응답([{"run_id": "r1"}]),
        state_store=저장소,
        notify=보낸것.append,
        environment="prod",
        expectations=[_기대_하나],
    )

    assert 첫회차.opened == ("probe",)
    assert 둘째회차.opened == ()
    assert len(보낸것) == 1


def test_위반이_사라지면_해소를_한_번_알린다() -> None:
    보낸것: list[str] = []
    저장소 = _기억하는_저장소()

    run_expectation_check(
        run_query=_응답([{"run_id": "r1"}]),
        state_store=저장소,
        notify=보낸것.append,
        environment="prod",
        expectations=[_기대_하나],
    )
    회차 = run_expectation_check(
        run_query=_응답([]),
        state_store=저장소,
        notify=보낸것.append,
        environment="prod",
        expectations=[_기대_하나],
    )

    assert 회차.resolved == ("probe",)
    assert 보낸것[-1].startswith("[prod] 해소됨: probe")
