"""모듈 책임: 발행이 실패했거나, 검증 뒤 멈췄거나, 해소되지 않은 제외가 남은 창 중 다시 시도할 가치가 있는
것 하나를 고른다.

가치의 정의가 이 모듈의 전부다. 실패한 publication은 그것을 만든 이미지와 지금 이미지가 다를 때만
고른다 — 같은 이미지로 다시 돌리면 같은 결과가 나오므로, 그 규칙 하나가 무한 반복을 막고 "파서를
고쳤을 때만 다시 시도한다"는 뜻을 그대로 적는다(EAT-274). 검증 뒤 멈춘(`validated`에 남은)
publication은 결과가 아니라 중단이라 이미지와 무관하게 한 번 고르고, 그 뒤 replay가 있었으면 다시
고르지 않는다(EAT-296). 발행은 성공했지만 원장에 해소되지 않은 제외가 남은 창은 실패와 같은 규칙이다 —
그 제외를 마지막으로 시도한 이미지와 지금 이미지가 다를 때만 고른다(ADR 0061 결정 5, EAT-294).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal
from uuid import UUID, uuid5

# `validated`에 이만큼 머문 publication을 멈춘 것으로 본다. 한 창의 project는 한 시간 남짓이라(1만 6천
# 건, 2026-09-17 실측) 여섯 시간이면 돌고 있는 발행을 멈춤으로 오판하지 않는다. 후보 질의와 감시 기대
# `stale-validated-publication`이 같은 값을 쓴다 — 둘이 갈리면 알림은 울리는데 재시도는 안 하는 창이 생긴다.
STALLED_VALIDATED_AFTER = "6 hours"

PublicationState = Literal["failed", "stalled", "excluded"]


@dataclass(frozen=True, slots=True)
class FailedPublication:
    """다시 시도할 후보 하나. 조회 결과를 그대로 담는 읽기 전용 값이다."""

    source_release_id: UUID
    publication_id: UUID
    build_sha: str
    window_start: str
    # failed는 발행이 결론을 내고 실패한 것, stalled는 검증까지 통과한 뒤 project가 결론 없이 사라져
    # `validated`에 남은 것이다(2026-09 daily-reconcile 두 창, core.organization 교착). excluded는 발행이
    # 성공했지만 원장에 적힌 제외가 아직 어느 revision도 얻지 못한 것이다(ADR 0061). 이 창은 원장 덕에
    # 완결이라 failed도 stalled도 아니다. 셋은 재시도할 이유가 달라 선택 규칙도 다르다.
    state: PublicationState
    # stalled에서만 뜻이 있다. 멈춘 publication이 검증된 시각과, 그 release의 관측으로 그 뒤에 시작한
    # replay run 가운데 가장 늦은 시작 시각이다. replay run은 `source_release_run`에 매이지 않으므로
    # 질의는 `replay_input` → `source_release_observation`으로 release를 찾는다.
    validated_at: datetime | None = None
    last_replay_started_at: datetime | None = None


def _worth_retrying(candidate: FailedPublication, *, build_sha: str) -> bool:
    # excluded의 build_sha는 해소되지 않은 제외 관측을 **마지막으로 정규화 시도한** run의 이미지다. 같은
    # 이미지로 다시 파싱하면 같은 격리가 나므로 실패와 같은 규칙이 무한 반복을 막는다. 마지막 시도 기준인
    # 이유: 새 이미지의 replay가 또 제외하거나 실패해도 그 시도가 "이 이미지로는 해 봤다"를 남긴다.
    if candidate.state in {"failed", "excluded"}:
        return candidate.build_sha != build_sha
    # 왜 이미지를 보지 않는가: 멈춤은 결정적인 결과가 아니라 교착·OOM·노드 유실 같은 중단이라 같은
    # 이미지로 다시 돌려도 풀린다. 대신 무한 반복은 "멈춘 뒤 replay가 한 번이라도 있었는가"로 막는다 —
    # 그 replay가 다시 멈췄다면 사람이 볼 차례이고, 감시 기대가 계속 열려 있다.
    if candidate.validated_at is None:
        return False
    return (
        candidate.last_replay_started_at is None
        or candidate.last_replay_started_at <= candidate.validated_at
    )


@dataclass(frozen=True, slots=True)
class ReplayTarget:
    source_release_id: UUID
    window_start: str
    # 다시 시도하게 만든 publication이다. 이름은 역사적이며 stalled 후보면 `validated`에 멈춘 것을 가리킨다.
    failed_publication_id: UUID
    # 실패한 publication id를 다시 쓰지 않는다. 같은 회차를 다시 돌려도 같은 값이 나오도록 run에서
    # 파생하므로 재실행이 새 정체성을 만들어 고아 발행을 남기지 않는다(discover와 같은 규칙).
    publication_id: UUID
    # replay가 요구하는 네 시각이다. 워크플로 엔진의 시각 변수에 기대지 않고 여기서 만드는 이유는
    # 그 변수의 지원 여부가 엔진 버전에 달려 있기 때문이다. 오름차순은 계약이라 코드가 보장한다.
    started_at: datetime
    normalized_at: datetime
    validated_at: datetime
    activated_at: datetime


def select_replay_target(
    candidates: tuple[FailedPublication, ...],
    *,
    build_sha: str,
    run_id: UUID,
    as_of: datetime,
) -> ReplayTarget | None:
    """다시 시도할 가치가 있는 창 하나를 고른다. 없으면 None이고 그것은 정상이다.

    실패한 창은 지금 이미지와 다른 이미지가 실패시켰을 때만, 멈춘 창은 멈춘 뒤 replay가 없을 때만, 제외가
    남은 창은 그 제외를 마지막으로 시도한 이미지가 지금 이미지와 다를 때만 고른다.

    왜 하나만 고르나: 발행은 `eatbid-core-publication` mutex로 직렬화되고 한 창이 1만 6천 건이라
    한 회차에 여럿을 잡아도 뒤엣것은 기다릴 뿐이다. 한 번에 하나씩 고르면 회차마다 지금 이미지로
    다시 판단하게 되어, 도중에 새 릴리스가 나가도 옛 판단을 들고 가지 않는다.
    """
    if not build_sha:
        raise ValueError("build_sha is required to decide retryability")
    if as_of.utcoffset() is None:
        raise ValueError("as_of must be timezone-aware")
    for candidate in candidates:
        if _worth_retrying(candidate, build_sha=build_sha):
            return ReplayTarget(
                source_release_id=candidate.source_release_id,
                window_start=candidate.window_start,
                failed_publication_id=candidate.publication_id,
                publication_id=uuid5(run_id, "eatbid:replay-publication"),
                started_at=as_of,
                normalized_at=as_of + timedelta(seconds=1),
                validated_at=as_of + timedelta(seconds=2),
                activated_at=as_of + timedelta(seconds=3),
            )
    return None
