"""모듈 책임: 지금 열려 있는 위반 집합을 이전 실행과 비교해 새로 생긴 것과 해소된 것만 가려낸다.

왜 필요한가: 한 원인이 여러 기대를 동시에 깨뜨리고(2026-09-10 자물쇠 교착 하나가 셋), 해소되기 전까지
매 회차 같은 위반이 다시 잡힌다. 그대로 보내면 같은 말이 반복돼 사람이 알림을 끄게 된다(ADR 0046 결정 6).

왜 DB가 아닌가: 상태를 PostgreSQL에 두려면 표가 필요하고 DDL 작성자는 Drizzle 하나뿐이다(AGENTS.md 10항).
감시가 스키마 변경을 요구하면 안 된다. 이미 배선된 R2에 작은 JSON 하나로 둔다.

관측하지 못한 것은 상태를 바꾸지 않는다: 어떤 기대의 질의가 예외로 끝나면 그 기대의 위반 행은 이번 회차에
하나도 없다. 그것을 "사라졌다"로 읽으면 검사가 흔들릴 때마다 "해소됨"이 나가고 first_seen_at이 초기화된다
(2026-09-16 코드 확인, EAT-242). 그래서 `<기대>:check-failed`가 있는 기대의 이전 위반은 해소가 아니라
관측 안 됨으로 남긴다. 모른다는 것은 유효한 상태다(AGENTS.md 3항).
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass

from .expectations import Violation

CHECK_FAILED_SUFFIX = ":check-failed"
OBSERVED = "observed"
UNOBSERVED = "unobserved"


@dataclass(frozen=True)
class OpenViolation:
    """열려 있는 위반 하나. 알림 문구를 그대로 들고 있는다.

    왜 key만 두지 않는가: 문구가 텔레그램에만 있으면 지금 무엇이 잘못됐는지는 그 방을 본 사람만 안다.
    운영을 돕는 에이전트도, 나중에 붙일 대시보드도 같은 사실을 읽을 수 있어야 한다(ADR 0046 결정 1,
    PostgreSQL과 R2가 진실이고 알림은 전달 수단이다). 이 문서가 "지금 무엇이 열려 있나"의 답이다.

    `observation`은 이번 회차에 실제로 관측됐는지(`observed`)와 기대 평가가 실패해 이전 상태를 그대로
    물려받았는지(`unobserved`)를 가른다. 후자는 해소가 아니다.
    """

    key: str
    first_seen_at: str
    title: str = ""
    detail: str = ""
    runbook: str = ""
    observation: str = OBSERVED


@dataclass(frozen=True)
class ViolationDiff:
    opened: tuple[Violation, ...]
    resolved: tuple[str, ...]
    still_open: tuple[OpenViolation, ...]


def diff_violations(
    current: Sequence[Violation],
    previous: Iterable[OpenViolation],
    now: str,
) -> ViolationDiff:
    """새로 열린 위반, 해소된 위반, 계속 열려 있는 위반을 나눈다.

    `now`는 문자열로 받는다. 시각 형식을 정하는 것은 호출자의 일이고 이 함수는 그것을 보관만 한다.
    """
    previous_by_key = {item.key: item for item in previous}
    current_by_key = {violation.key: violation for violation in current}
    unobserved_prefixes = tuple(
        key[: -len(CHECK_FAILED_SUFFIX)]
        for key in current_by_key
        if key.endswith(CHECK_FAILED_SUFFIX)
    )

    def _unobserved(key: str) -> bool:
        # 위반 key는 `<기대 key>` 또는 `<기대 key>:<행 key>`다(expectations._row_key, cluster.judge_*).
        # 접두사가 같으면 같은 기대에서 나온 것이고, 그 기대의 평가가 이번 회차에 실패한 것이다.
        return any(
            key == prefix or key.startswith(f"{prefix}:")
            for prefix in unobserved_prefixes
        )

    opened = tuple(
        violation
        for key, violation in current_by_key.items()
        if key not in previous_by_key
    )
    resolved = tuple(
        key
        for key in previous_by_key
        if key not in current_by_key and not _unobserved(key)
    )
    observed = tuple(
        OpenViolation(
            key=key,
            # 처음 본 시각은 이전 상태에서 물려받는다. 매 회차 갱신하면 얼마나 오래 열려 있었는지를
            # 잃어버린다 — 그 값이 "이틀째 같은 것이 열려 있다"를 말해 주는 유일한 근거다.
            first_seen_at=(
                previous_by_key[key].first_seen_at if key in previous_by_key else now
            ),
            title=violation.title,
            detail=violation.detail,
            runbook=violation.runbook,
            observation=OBSERVED,
        )
        for key, violation in current_by_key.items()
    )
    # 평가가 실패한 기대의 이전 위반은 문구와 처음 본 시각을 그대로 물려받아 열린 채로 둔다. 해소 알림을
    # 내지 않고, 회복된 회차에 다시 관측되면 observed로 돌아오되 first_seen_at은 이어진다.
    carried = tuple(
        OpenViolation(
            key=item.key,
            first_seen_at=item.first_seen_at,
            title=item.title,
            detail=item.detail,
            runbook=item.runbook,
            observation=UNOBSERVED,
        )
        for key, item in previous_by_key.items()
        if key not in current_by_key and _unobserved(key)
    )
    return ViolationDiff(
        opened=opened, resolved=resolved, still_open=observed + carried
    )


def decode_state(document: Mapping[str, object] | None) -> tuple[OpenViolation, ...]:
    """저장된 상태를 읽는다. 형식이 낯설면 빈 것으로 본다.

    상태가 깨졌을 때 검사를 멈추는 것보다 한 번 더 알리는 쪽이 안전하다.
    """
    if not document:
        return ()
    raw = document.get("open")
    if not isinstance(raw, list):
        return ()
    decoded: list[OpenViolation] = []
    for item in raw:
        if not isinstance(item, Mapping):
            continue
        key = item.get("key")
        first_seen_at = item.get("first_seen_at")
        if isinstance(key, str) and isinstance(first_seen_at, str):
            # 문구 세 개는 없어도 읽는다. 이 필드를 더하기 전에 쓰인 문서가 R2에 남아 있고, 그것 때문에
            # 열려 있던 위반이 전부 "새로 열림"으로 다시 알려지면 안 된다.
            decoded.append(
                OpenViolation(
                    key=key,
                    first_seen_at=first_seen_at,
                    title=str(item.get("title") or ""),
                    detail=str(item.get("detail") or ""),
                    runbook=str(item.get("runbook") or ""),
                    # 이 필드가 없던 옛 문서는 전부 관측된 것으로 읽는다. 그 문서를 쓴 회차에는 관측 안 됨이라는
                    # 상태가 없었으므로 그것이 그 시점의 사실이다.
                    observation=str(item.get("observation") or OBSERVED),
                )
            )
    return tuple(decoded)


def encode_state(
    open_violations: Sequence[OpenViolation], now: str
) -> dict[str, object]:
    return {
        "updated_at": now,
        "open": [
            {
                "key": item.key,
                "first_seen_at": item.first_seen_at,
                "title": item.title,
                "detail": item.detail,
                "runbook": item.runbook,
                "observation": item.observation,
            }
            for item in open_violations
        ],
    }
