"""모듈 책임: 배포 파이프라인이 초록인지를 GitHub Actions 회차의 공개 사실만 보고 판정한다.

왜 클러스터 **안에서** GitHub에 묻는가: 알림을 GitHub Actions 단계에서 보내면 Actions가 도는 동안에만
말할 수 있다. 2026-09-13에 결제 한도로 회차가 통째로 시작되지 못했고, 그 방식이었다면 하루 종일 조용했을
것이다. 밖에서 물으면 "회차가 실패했다"와 "회차가 시작조차 못 했다"가 같은 자리에서 보인다.

왜 토큰이 없는가: 저장소가 공개라 회차 목록은 인증 없이 읽힌다. 알림 봇 토큰을 GitHub 비밀값으로 한 벌 더
복제하지 않는 것이 이 선택이 사는 값이다. 대신 익명 호출은 시간당 한도를 받으므로 한 회차에 워크플로 수만큼만
묻는다.

왜 판정이 순수 함수인가: 초록·빨강·대기의 경계는 GitHub 없이 검증할 수 있어야 한다. 조회는 호출자가 넣는다.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from .expectations import Violation
from .explanation import check_failed_explanation, explain

__all__ = [
    "GITHUB_EXPECTATIONS",
    "RunFetcher",
    "WorkflowExpectation",
    "evaluate_workflows",
    "judge_runs",
]

RunFetcher = Callable[["WorkflowExpectation"], Sequence[Mapping[str, Any]]]

# 초록으로 볼 결론. `skipped`와 `neutral`은 그 회차가 할 일이 없었다는 뜻이라 검증을 깨뜨리지 않는다.
# 나머지는 전부 빨강으로 본다 — `cancelled`도 포함한다. 검증이 끝까지 가지 않은 main은 검증되지 않은
# main이고, 결제 한도로 멈췄을 때 실제로 남은 결론이 그것이었다.
_GREEN_CONCLUSIONS: frozenset[str] = frozenset({"success", "skipped", "neutral"})

# 아직 끝나지 않은 회차의 상태. GitHub은 여기에 값을 더해 왔으므로 끝난 상태를 열거하지 않고 이 쪽을 센다.
_PENDING_STATUSES: frozenset[str] = frozenset(
    {"queued", "in_progress", "waiting", "requested", "pending"}
)


@dataclass(frozen=True)
class WorkflowExpectation:
    """워크플로 하나에 거는 기대.

    `branch`가 `None`인 워크플로가 있는 이유는 release 발행이 tag에서 시작되기 때문이다(ADR 0024).
    tag 회차에는 의미 있는 branch가 없어서 branch로 거르면 아무것도 잡히지 않는다.
    """

    key: str
    title: str
    runbook: str
    workflow_file: str
    branch: str | None
    stall_after: timedelta
    # 빨강일 때 사람에게 하는 말. 멈춤(stalled)은 워크플로와 무관하게 "러너를 못 받는다"가 원인이라 공통 문구다.
    what: str = ""
    impact: str = ""


GITHUB_EXPECTATIONS: tuple[WorkflowExpectation, ...] = (
    WorkflowExpectation(
        key="ci-main-green",
        title="원격 main의 최신 변경 검증이 초록이다",
        runbook="docs/operations/ci-gate-failure-response.md",
        workflow_file="validate.yml",
        branch="main",
        # 이 저장소의 가장 긴 회차가 browser 검증이고 그것이 15분대다. 45분을 넘겼다면 느린 것이 아니라
        # runner를 못 받고 있는 것이다.
        stall_after=timedelta(minutes=45),
        what="main에 들어간 최신 변경의 자동 검증이 실패했습니다",
        impact="다음 릴리스를 만들 수 없고, 열린 PR의 자동 병합도 막힙니다. 지금 사이트에는 영향이 없습니다",
    ),
    WorkflowExpectation(
        key="release-publication",
        title="최신 release 발행이 끝까지 갔다",
        runbook="docs/operations/ci-gate-failure-response.md",
        workflow_file="build.yml",
        branch=None,
        # 발행은 서명·빌드·promote까지 가므로 검증보다 길다.
        stall_after=timedelta(minutes=60),
        what="최신 릴리스 빌드·발행이 끝까지 가지 못했습니다",
        impact="새 버전이 운영에 올라가지 않았습니다. 사이트는 이전 버전으로 계속 돕니다",
    ),
)


def _status(run: Mapping[str, Any]) -> str:
    return str(run.get("status") or "")


def _created_at(run: Mapping[str, Any]) -> datetime | None:
    raw = run.get("created_at")
    if not isinstance(raw, str) or not raw:
        return None
    try:
        # GitHub은 `2026-09-14T09:36:43Z` 모양으로 준다. Python 3.12의 `fromisoformat`은 `Z`를 그대로 읽는다.
        moment = datetime.fromisoformat(raw)
    except ValueError:
        return None
    return moment if moment.tzinfo is not None else moment.replace(tzinfo=UTC)


def _describe(run: Mapping[str, Any]) -> str:
    parts = [
        f"결론={run.get('conclusion') or _status(run) or 'unknown'}",
        f"제목={run.get('display_title') or run.get('name') or 'unknown'}",
        f"회차={run.get('html_url') or run.get('id') or 'unknown'}",
    ]
    return ", ".join(parts)


def judge_runs(
    expectation: WorkflowExpectation,
    runs: Sequence[Mapping[str, Any]],
    *,
    now: datetime,
) -> list[Violation]:
    """최신 회차들을 보고 위반만 돌려준다.

    회차가 하나도 없으면 위반이 아니다. 아직 한 번도 돌지 않은 워크플로와 고장난 워크플로는 다른 사실이고,
    모르는 것을 위반으로 부르면 그 구분이 사라진다(AGENTS.md 3항).

    두 판정의 key를 나누는 이유는 한 워크플로가 두 가지로 어긋날 수 있어서다 — 회차가 실패한 것과 회차가
    시작조차 못 하는 것은 대응이 다르다. 같은 key를 쓰면 상태 파일에서 한쪽이 다른 쪽을 덮어써 둘 중
    하나가 영영 보이지 않는다.
    """
    ordered = sorted(
        runs, key=lambda run: str(run.get("created_at") or ""), reverse=True
    )
    if not ordered:
        return []

    violations: list[Violation] = []
    latest = ordered[0]
    if _status(latest) in _PENDING_STATUSES:
        created = _created_at(latest)
        if created is not None and now - created >= expectation.stall_after:
            waited = int((now - created).total_seconds() // 60)
            violations.append(
                Violation(
                    key=f"{expectation.key}:stalled",
                    title=f"{expectation.title} — 회차가 {waited}분째 끝나지 않았다",
                    runbook=expectation.runbook,
                    detail=_describe(latest),
                    explanation=explain(
                        f"GitHub 자동 작업({expectation.workflow_file})이 {waited}분째 끝나지 않습니다",
                        "실행기를 못 받고 있을 가능성이 큽니다(결제 한도 등). 그동안 검증·릴리스가 멈춥니다",
                    ),
                )
            )

    finished = next(
        (run for run in ordered if _status(run) not in _PENDING_STATUSES), None
    )
    if (
        finished is not None
        and str(finished.get("conclusion") or "") not in _GREEN_CONCLUSIONS
    ):
        # 열려 있는 동안 다른 회차가 또 실패해도 다시 알리지 않는다. 같은 사고 하나가 여러 알림으로
        # 쪼개지지 않게 하는 것이 억제의 목적이다(ADR 0046 결정 6). 초록이 되면 해소로 한 번 알린다.
        violations.append(
            Violation(
                key=f"{expectation.key}:red",
                title=expectation.title,
                runbook=expectation.runbook,
                detail=_describe(finished),
                explanation=explain(expectation.what, expectation.impact),
            )
        )
    return violations


def evaluate_workflows(
    fetch_runs: RunFetcher,
    expectations: Sequence[WorkflowExpectation] = GITHUB_EXPECTATIONS,
    *,
    now: datetime | None = None,
) -> list[Violation]:
    """각 워크플로를 조회해 위반만 돌려준다.

    조회 자체가 실패하면 그 사실을 위반으로 올린다. GitHub에 못 묻는 동안은 CI가 초록인지 모르는 상태이지
    초록인 상태가 아니다.
    """
    moment = now or datetime.now(UTC)
    violations: list[Violation] = []
    for expectation in expectations:
        try:
            runs = fetch_runs(expectation)
        except Exception as error:  # noqa: BLE001 - 어떤 실패든 사람에게 알린다
            violations.append(
                Violation(
                    key=f"{expectation.key}:check-failed",
                    title=f"기대 '{expectation.title}'를 평가하지 못했다",
                    runbook=expectation.runbook,
                    detail=f"{type(error).__name__}: {error}",
                    explanation=check_failed_explanation(expectation.title),
                )
            )
            continue
        violations.extend(judge_runs(expectation, runs, now=moment))
    return violations
