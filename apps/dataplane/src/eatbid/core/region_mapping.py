"""모듈 책임: 관측된 eaT 지역 라벨과 행안부 release 라벨 사이에서 **양쪽 모두 유일한** 결정적
일치만 매핑 후보로 만든다. 데이터베이스는 모른다.

DB 접근과 나눈 이유는 이 규칙이 곧 "무엇을 같다고 볼 것인가"의 정의이기 때문이다. 순수 함수로
두어야 후보 2개 이상이 왜 행이 되지 않는지를 질의 없이 테스트로 고정할 수 있다.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from eatbid.code_labels import label_path_segments, normalize_code_label

# eaT `PDLC_NM`이 "이 시도 전체"를 뜻할 때 쓰는 소스 토막이다. 지역 이름이 아니라 소스가 쓰는
# 한정어이므로 지역 어휘 선언이 아니다. 실측: `서울 / 전체`·`경기/전체` 형태(census-detail.txt §3).
EAT_WHOLE_AREA_SEGMENT = "전체"

# `relation`은 둘만 쓴다. `exact`는 같은 구역을 가리킨다는 주장이고, `overlaps`는 한 코드가 두 구역에
# 걸쳐 있다는 사실이다. 후자는 자동으로 만들 수 없다(ADR 0035 결정 6).
EXACT_RELATION = "exact"
OVERLAPS_RELATION = "overlaps"

# 자동 생성 행의 상태다. 사람이 승인했거나 정부 대조표가 있는 행은 `reviewed`이며 이 모듈이 만들지
# 않는다.
LABEL_VERIFIED_STATUS = "label_verified"
REVIEWED_STATUS = "reviewed"


@dataclass(frozen=True, slots=True)
class RegionMappingCandidate:
    from_code_value_id: int
    to_code_value_id: int
    relation: str
    status: str


@dataclass(frozen=True, slots=True)
class RegionMappingProposal:
    """무엇을 만들었고 무엇을 만들지 못했는지를 한 값으로 함께 든다.

    미매핑을 예외로 던지지 않는 이유는 미매핑이 정상 상태이기 때문이다. 수집 창 밖의 코드는 라벨이
    아직 관측되지 않았을 뿐이고, 그 수는 coverage 문서가 센다(ADR 0035 결정 6).
    """

    candidates: tuple[RegionMappingCandidate, ...]
    ambiguous_source_code_value_ids: tuple[int, ...]
    unmatched_source_code_value_ids: tuple[int, ...]
    source_code_value_ids_without_label: tuple[int, ...]


def eat_label_path(label: str) -> tuple[str, ...]:
    """eaT 지역 라벨을 이름 토막 경로로 읽는다.

    `서울 / 전체`와 `서울/전체`는 같은 경로다. 실측에서 `PDLC_NM`의 이름 다중 79건이 전부 이
    변이였다. 마지막 토막이 `전체`면 그 시도 자체를 가리키므로 토막에서 뺀다.
    """
    segments = [
        normalize_code_label(segment)
        for segment in normalize_code_label(label).split("/")
        if normalize_code_label(segment)
    ]
    if len(segments) > 1 and segments[-1] == EAT_WHOLE_AREA_SEGMENT:
        segments = segments[:-1]
    return tuple(segments)


def propose_region_mappings(
    *,
    source_labels: Mapping[int, Sequence[str]],
    target_labels: Mapping[int, Sequence[str]],
) -> RegionMappingProposal:
    """양쪽 라벨에서 **결정적 일치가 양쪽 모두 유일할 때만** 후보를 만든다.

    유사도·부분 문자열·주소 파싱은 쓰지 않는다. PDR-0001이 그 경로에서 나온 오염(`기해시`)으로
    이미 기각했다. 대신 만들지 못한 이유를 셋으로 갈라 보고한다 — 라벨이 없음, 대상이 없음, 후보가
    둘 이상임.
    """
    target_index = _unique_path_index(target_labels)
    source_paths: dict[int, set[tuple[str, ...]]] = {
        code_value_id: {eat_label_path(label) for label in labels if label.strip()}
        for code_value_id, labels in source_labels.items()
    }
    claimed = Counter(
        target_index[path]
        for paths in source_paths.values()
        for path in paths
        if path in target_index
    )

    candidates: list[RegionMappingCandidate] = []
    ambiguous: list[int] = []
    unmatched: list[int] = []
    without_label: list[int] = []
    for code_value_id in sorted(source_paths):
        paths = source_paths[code_value_id]
        if not paths:
            without_label.append(code_value_id)
            continue
        targets = {target_index[path] for path in paths if path in target_index}
        if len(targets) > 1:
            # 한 eaT 코드가 두 행안부 코드에 걸리면 그것은 `overlaps`이고 사람이 만든다.
            ambiguous.append(code_value_id)
            continue
        if not targets:
            unmatched.append(code_value_id)
            continue
        target_id = next(iter(targets))
        if claimed[target_id] > 1:
            # 같은 행안부 코드를 두 eaT 코드가 주장하면 어느 쪽이 등가인지 우리가 고르게 된다.
            ambiguous.append(code_value_id)
            continue
        candidates.append(
            RegionMappingCandidate(
                from_code_value_id=code_value_id,
                to_code_value_id=target_id,
                relation=EXACT_RELATION,
                status=LABEL_VERIFIED_STATUS,
            )
        )
    return RegionMappingProposal(
        candidates=tuple(candidates),
        ambiguous_source_code_value_ids=tuple(sorted(ambiguous)),
        unmatched_source_code_value_ids=tuple(sorted(unmatched)),
        source_code_value_ids_without_label=tuple(sorted(without_label)),
    )


def _unique_path_index(
    target_labels: Mapping[int, Sequence[str]],
) -> dict[tuple[str, ...], int]:
    """행안부 라벨 경로 → code_value_id. 경로가 유일한 것만 남긴다."""
    owners: dict[tuple[str, ...], set[int]] = defaultdict(set)
    for code_value_id, labels in target_labels.items():
        for label in labels:
            if not label.strip():
                continue
            owners[label_path_segments(label)].add(code_value_id)
    return {
        path: next(iter(code_value_ids))
        for path, code_value_ids in owners.items()
        if len(code_value_ids) == 1
    }
