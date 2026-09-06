from __future__ import annotations

from eatbid.core.region_mapping import (
    EXACT_RELATION,
    LABEL_VERIFIED_STATUS,
    OVERLAPS_RELATION,
    eat_label_path,
    propose_region_mappings,
)

# 행안부 release 쪽 라벨이다. code_value_id는 숫자 정체성이며 이름은 대조에만 쓴다.
행안부 = {
    10: ["서울특별시"],
    11: ["서울특별시 종로구"],
    20: ["경기도"],
    21: ["경기도 수원시"],
    22: ["경기도 수원시 장안구"],
}


def test_PDLC_CD를_자릿수로_쪼개_시군구를_만들지_않는다() -> None:
    # 입력은 코드가 아니라 라벨뿐이다. 코드 문자열을 받는 자리가 함수 서명에 없다.
    proposal = propose_region_mappings(source_labels={1: []}, target_labels=행안부)
    assert proposal.candidates == ()
    assert proposal.source_code_value_ids_without_label == (1,)


def test_공백_변이는_같은_라벨로_모이지만_이름_유사도로는_잇지_않는다() -> None:
    같은_변이 = propose_region_mappings(
        source_labels={1: ["서울특별시 / 전체"], 2: ["서울특별시/전체"]},
        target_labels={10: ["서울특별시"]},
    )
    # 두 eaT 코드가 같은 행안부 코드를 주장하므로 어느 쪽도 만들지 않는다.
    assert 같은_변이.candidates == ()
    assert 같은_변이.ambiguous_source_code_value_ids == (1, 2)

    하나뿐 = propose_region_mappings(
        source_labels={1: ["서울특별시 / 전체", "서울특별시/전체"]},
        target_labels={10: ["서울특별시"]},
    )
    assert len(하나뿐.candidates) == 1
    assert 하나뿐.candidates[0].to_code_value_id == 10

    유사 = propose_region_mappings(
        source_labels={1: ["서울특별시립/전체"]}, target_labels={10: ["서울특별시"]}
    )
    assert 유사.candidates == ()
    assert 유사.unmatched_source_code_value_ids == (1,)


def test_후보가_둘_이상이면_매핑을_만들지_않는다() -> None:
    # 한 eaT 코드가 두 경로를 관측했고 그 둘이 다른 행안부 코드다.
    proposal = propose_region_mappings(
        source_labels={1: ["서울특별시/전체", "경기도/전체"]}, target_labels=행안부
    )
    assert proposal.candidates == ()
    assert proposal.ambiguous_source_code_value_ids == (1,)

    # 행안부 쪽에서 같은 이름 경로를 두 코드가 쓰면 그 경로는 색인에서 빠진다.
    중복 = propose_region_mappings(
        source_labels={1: ["경기도/수원시"]},
        target_labels={21: ["경기도 수원시"], 29: ["경기도 수원시"]},
    )
    assert 중복.candidates == ()
    assert 중복.unmatched_source_code_value_ids == (1,)


def test_전체_토막은_시도_자체를_가리키고_시군구_토막은_그대로_대조한다() -> None:
    assert eat_label_path("서울특별시 / 전체") == ("서울특별시",)
    assert eat_label_path("경기도/수원시") == ("경기도", "수원시")
    assert eat_label_path("경기도/수원시/장안구") == ("경기도", "수원시", "장안구")

    proposal = propose_region_mappings(
        source_labels={1: ["서울특별시/전체"], 2: ["경기도/수원시/장안구"]},
        target_labels=행안부,
    )
    mapped = {item.from_code_value_id: item.to_code_value_id for item in proposal.candidates}
    assert mapped == {1: 10, 2: 22}


def test_자동_생성_행은_exact_label_verified_뿐이다() -> None:
    proposal = propose_region_mappings(
        source_labels={1: ["서울특별시/전체"]}, target_labels=행안부
    )
    candidate = proposal.candidates[0]
    assert candidate.relation == EXACT_RELATION
    assert candidate.status == LABEL_VERIFIED_STATUS
    # overlaps는 자동 생성 경로에서 나오지 않는다. 사람이 만드는 유일한 부류다.
    assert all(item.relation != OVERLAPS_RELATION for item in proposal.candidates)


def test_매핑없는_코드는_행_대신_미매핑_수로_보고된다() -> None:
    proposal = propose_region_mappings(
        source_labels={1: ["세종/전체"], 2: [], 3: ["서울특별시/전체"]},
        target_labels=행안부,
    )
    assert len(proposal.candidates) == 1
    assert proposal.unmatched_source_code_value_ids == (1,)
    assert proposal.source_code_value_ids_without_label == (2,)
