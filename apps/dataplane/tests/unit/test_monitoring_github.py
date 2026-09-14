"""모듈 책임: GitHub 회차를 초록·빨강·대기로 가르는 경계를 GitHub 없이 고정한다."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

from eatbid.monitoring.github import (
    GITHUB_EXPECTATIONS,
    WorkflowExpectation,
    evaluate_workflows,
    judge_runs,
)

_지금 = datetime(2026, 9, 14, 12, 0, tzinfo=UTC)

_기대 = WorkflowExpectation(
    key="ci-main-green",
    title="원격 main의 최신 변경 검증이 초록이다",
    runbook="docs/operations/ci-gate-failure-response.md",
    workflow_file="validate.yml",
    branch="main",
    stall_after=timedelta(minutes=45),
)


def _회차(
    *,
    status: str = "completed",
    conclusion: str | None = "success",
    minutes_ago: int = 5,
    title: str = "어떤 변경",
) -> dict[str, Any]:
    return {
        "status": status,
        "conclusion": conclusion,
        "created_at": (_지금 - timedelta(minutes=minutes_ago))
        .isoformat()
        .replace("+00:00", "Z"),
        "display_title": title,
        "html_url": "https://github.com/Lamyzm/eat-bid-service/actions/runs/1",
    }


def test_최신_회차가_성공이면_위반이_없다() -> None:
    assert judge_runs(_기대, [_회차()], now=_지금) == []


@pytest.mark.parametrize("결론", ["skipped", "neutral"])
def test_할_일이_없던_회차는_초록으로_본다(결론: str) -> None:
    assert judge_runs(_기대, [_회차(conclusion=결론)], now=_지금) == []


@pytest.mark.parametrize(
    "결론", ["failure", "cancelled", "timed_out", "startup_failure"]
)
def test_끝까지_가지_않은_회차는_빨강으로_본다(결론: str) -> None:
    # cancelled를 포함하는 이유: 검증이 끝까지 가지 않은 main은 검증되지 않은 main이다. 2026-09-13
    # 결제 한도 때 실제로 남은 결론이 그것이었다.
    위반 = judge_runs(_기대, [_회차(conclusion=결론)], now=_지금)

    assert [v.key for v in 위반] == ["ci-main-green:red"]
    assert 결론 in 위반[0].detail
    assert 위반[0].runbook == "docs/operations/ci-gate-failure-response.md"


def test_회차가_한_번도_없으면_위반이_아니다() -> None:
    # 아직 안 돈 워크플로와 고장난 워크플로는 다른 사실이다(AGENTS.md 3항).
    assert judge_runs(_기대, [], now=_지금) == []


def test_대기_중인_회차가_임계를_넘으면_따로_잡는다() -> None:
    위반 = judge_runs(
        _기대, [_회차(status="queued", conclusion=None, minutes_ago=90)], now=_지금
    )

    assert [v.key for v in 위반] == ["ci-main-green:stalled"]
    assert "90분째" in 위반[0].title


def test_아직_도는_중인_회차는_임계_안에서는_건드리지_않는다() -> None:
    회차 = _회차(status="in_progress", conclusion=None, minutes_ago=10)

    assert judge_runs(_기대, [회차], now=_지금) == []


def test_도는_회차_뒤에_끝난_회차가_빨강이면_그것을_본다() -> None:
    # 진행 중인 회차는 아직 판정이 없다. 판정은 마지막으로 끝난 회차가 준다.
    위반 = judge_runs(
        _기대,
        [
            _회차(status="in_progress", conclusion=None, minutes_ago=3),
            _회차(conclusion="failure", minutes_ago=40),
        ],
        now=_지금,
    )

    assert [v.key for v in 위반] == ["ci-main-green:red"]


def test_멈춤과_빨강은_key가_달라_서로를_덮지_않는다() -> None:
    # 같은 key를 쓰면 상태 파일에서 한쪽이 다른 쪽을 덮어써 둘 중 하나가 영영 보이지 않는다.
    위반 = judge_runs(
        _기대,
        [
            _회차(status="queued", conclusion=None, minutes_ago=120),
            _회차(conclusion="failure", minutes_ago=200),
        ],
        now=_지금,
    )

    assert sorted(v.key for v in 위반) == ["ci-main-green:red", "ci-main-green:stalled"]


def test_순서가_뒤섞여_와도_만들어진_시각으로_최신을_고른다() -> None:
    위반 = judge_runs(
        _기대,
        [
            _회차(conclusion="failure", minutes_ago=200),
            _회차(conclusion="success", minutes_ago=5),
        ],
        now=_지금,
    )

    assert 위반 == []


def test_조회가_실패하면_그_사실을_위반으로_올린다() -> None:
    # GitHub에 못 묻는 동안은 초록인지 모르는 상태이지 초록인 상태가 아니다.
    def 실패(_: WorkflowExpectation) -> list[dict[str, Any]]:
        raise TimeoutError("연결 시간 초과")

    위반 = evaluate_workflows(실패, [_기대], now=_지금)

    assert [v.key for v in 위반] == ["ci-main-green:check-failed"]
    assert "TimeoutError" in 위반[0].detail


def test_선언된_기대는_key가_서로_다르다() -> None:
    keys = [기대.key for 기대 in GITHUB_EXPECTATIONS]

    assert len(keys) == len(set(keys))


def test_release_발행_기대는_branch로_거르지_않는다() -> None:
    # 발행은 tag에서 시작되므로(ADR 0024) branch로 거르면 아무것도 잡히지 않는다.
    발행 = next(
        기대 for 기대 in GITHUB_EXPECTATIONS if 기대.workflow_file == "build.yml"
    )

    assert 발행.branch is None
