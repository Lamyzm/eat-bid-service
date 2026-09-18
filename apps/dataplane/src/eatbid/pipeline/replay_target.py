"""모듈 책임: 발행이 실패한 창 중 다시 시도할 가치가 있는 것 하나를 고른다.

가치의 정의가 이 모듈의 전부다 — 실패한 publication을 만든 이미지와 지금 이미지가 다를 때만 고른다.
같은 이미지로 다시 돌리면 같은 결과가 나오므로, 그 규칙 하나가 무한 반복을 막고 "파서를 고쳤을 때만
다시 시도한다"는 뜻을 그대로 적는다(EAT-274).
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID, uuid5


@dataclass(frozen=True, slots=True)
class FailedPublication:
    """다시 시도할 후보 하나. 조회 결과를 그대로 담는 읽기 전용 값이다."""

    source_release_id: UUID
    publication_id: UUID
    build_sha: str
    window_start: str


@dataclass(frozen=True, slots=True)
class ReplayTarget:
    source_release_id: UUID
    window_start: str
    failed_publication_id: UUID
    # 실패한 publication id를 다시 쓰지 않는다. 같은 회차를 다시 돌려도 같은 값이 나오도록 run에서
    # 파생하므로 재실행이 새 정체성을 만들어 고아 발행을 남기지 않는다(discover와 같은 규칙).
    publication_id: UUID


def select_replay_target(
    candidates: tuple[FailedPublication, ...], *, build_sha: str, run_id: UUID
) -> ReplayTarget | None:
    """지금 이미지와 다른 이미지가 실패시킨 창 하나를 고른다. 없으면 None이고 그것은 정상이다.

    왜 하나만 고르나: 발행은 `eatbid-core-publication` mutex로 직렬화되고 한 창이 1만 6천 건이라
    한 회차에 여럿을 잡아도 뒤엣것은 기다릴 뿐이다. 한 번에 하나씩 고르면 회차마다 지금 이미지로
    다시 판단하게 되어, 도중에 새 릴리스가 나가도 옛 판단을 들고 가지 않는다.
    """
    if not build_sha:
        raise ValueError("build_sha is required to decide retryability")
    for candidate in candidates:
        if candidate.build_sha != build_sha:
            return ReplayTarget(
                source_release_id=candidate.source_release_id,
                window_start=candidate.window_start,
                failed_publication_id=candidate.publication_id,
                publication_id=uuid5(run_id, "eatbid:replay-publication"),
            )
    return None
