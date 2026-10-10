"""모듈 책임: 클러스터 판정(cluster.py)이 내는 위반을 사람 말(무슨 일·영향·급함)로 옮기는 선언을 소유한다.

왜 판정과 나누는가: 노드·Application·cron의 경계는 Kubernetes 상태가 바뀔 때 바뀌고, 문구는 사람이 읽기 어렵다는
이유로 바뀐다. 한 파일에 두면 문구를 다듬는 변경이 판정 코드 diff에 섞인다.
"""

from __future__ import annotations

from collections.abc import Mapping

from .explanation import Explanation, explain

LIVE_CRON = "eatbid-poll-open"
"""실시간 수집 cron. 이것만 실패가 critical이다(cluster.judge_cron_workflows)."""

# cron마다 실패가 화면에 미치는 영향이 다르다. 이름을 모르는 cron은 영향을 지어내지 않고 "확인 못 함"이다.
CRON_IMPACTS: Mapping[str, str] = {
    LIVE_CRON: "이번 회차의 새 공고가 화면에 들어오지 않았습니다",
    "eatbid-poll-results": "이번 회차 개찰 결과가 늦게 들어옵니다. 다음 정시 수집 회차가 대신 가져옵니다",
    "eatbid-daily-reconcile": "지난 이레 공고의 변경·마감 대조가 빠져 화면 일부가 옛 상태일 수 있습니다",
    "eatbid-backfill-advance": "과거 공고 채우기가 이번 시간만큼 늦어집니다. 오늘 공고에는 영향이 없습니다",
    "eatbid-replay-advance": "실패했던 발행을 다시 돌리는 일이 늦어져 빠진 공고가 그만큼 오래 비어 있습니다",
    "eatbid-db-backup": "이번 시간 DB 백업이 없습니다. 지금 사고가 나면 그만큼 더 잃습니다",
    "eatbid-mart-reap": "지난 분석 결과 정리가 밀려 DB 디스크가 계속 찹니다",
    "eatbid-history-marts": "분석·기관 이력 화면이 새 개찰 결과를 반영하지 못하고 앞 회차 기준에 머뭅니다",
    "eatbid-expectation-check": "이 감시 회차가 끝나지 못했습니다. 그 사이 문제는 알림이 늦게 옵니다",
    "eatbid-reference-refresh": "지역·기관 기준정보가 갱신되지 않았습니다",
}


def cron_explanation(cron: str, severity: str) -> Explanation:
    return explain(
        f"예약 작업 {cron}의 마지막 회차가 실패했습니다",
        CRON_IMPACTS.get(
            cron, "확인 못 함 — 이 예약 작업의 영향은 아직 적어 두지 않았습니다"
        ),
        severity=severity,
    )


NODE_EMPTY_EXPLANATION = explain(
    "클러스터가 노드를 하나도 돌려주지 않습니다",
    "서버·웹·수집이 전부 멈췄을 수 있습니다. 사이트가 열리지 않을 가능성이 큽니다",
    severity="critical",
)
NODE_NOT_READY_EXPLANATION = explain(
    "서버 기계(노드)가 정상 상태가 아닙니다",
    "그 기계에서 도는 사이트·API·수집이 멈췄거나 곧 멈춥니다",
    severity="critical",
)
NODE_CORDONED_EXPLANATION = explain(
    "서버 기계(노드)가 새 작업을 받지 않도록 막혀 있습니다",
    "지금 도는 것은 그대로지만 다음 수집 회차와 재시작이 대기열에 쌓입니다",
    severity="critical",
)
APPLICATION_EMPTY_EXPLANATION = explain(
    "배포 도구(Argo CD)가 관리하는 앱이 하나도 보이지 않습니다",
    "배포 상태를 알 수 없고, 새 릴리스가 반영되지 않습니다",
    severity="critical",
)
APPLICATION_DRIFT_EXPLANATION = explain(
    "배포된 상태가 저장소와 다르거나 앱 상태가 비정상입니다",
    "사이트가 옛 버전이거나 일부가 죽어 있을 수 있습니다",
    severity="critical",
)
