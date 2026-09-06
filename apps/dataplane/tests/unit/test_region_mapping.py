from __future__ import annotations

from eatbid.core.region_label_aliases import SIDO_LABEL_ALIASES, official_sido_labels
from eatbid.core.region_mapping import (
    EXACT_RELATION,
    LABEL_VERIFIED_STATUS,
    OVERLAPS_RELATION,
    REVIEWED_STATUS,
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


def test_자동_생성_행의_relation은_언제나_exact다() -> None:
    proposal = propose_region_mappings(
        source_labels={1: ["서울특별시/전체"], 2: ["경기도/수원시"]},
        target_labels=행안부,
    )
    assert {item.relation for item in proposal.candidates} == {EXACT_RELATION}
    # overlaps는 자동 생성 경로에서 나오지 않는다. 사람이 만드는 유일한 부류다.
    assert all(item.relation != OVERLAPS_RELATION for item in proposal.candidates)


def test_시도_행은_reviewed이고_시군구_행은_label_verified다() -> None:
    # 시도 대응의 근거는 승인된 별칭 표이고, 시군구 대응의 근거는 그 시도 안의 유일한 라벨 일치다.
    proposal = propose_region_mappings(
        source_labels={1: ["서울/전체"], 2: ["서울/종로구"]}, target_labels=행안부
    )
    상태 = {item.from_code_value_id: item.status for item in proposal.candidates}
    assert 상태 == {1: REVIEWED_STATUS, 2: LABEL_VERIFIED_STATUS}


def test_축약_시도명은_승인된_별칭_표로만_정식명에_닿는다() -> None:
    # eaT `PDLC_NM`은 `서울/노원구`처럼 시도를 축약해 보낸다. 표에 있는 축약만 열린다.
    닿음 = propose_region_mappings(
        source_labels={1: ["서울/전체"], 2: ["경기/수원시"], 3: ["경기/수원시/장안구"]},
        target_labels=행안부,
    )
    assert {
        item.from_code_value_id: item.to_code_value_id for item in 닿음.candidates
    } == {1: 10, 2: 21, 3: 22}

    # 표에 없는 축약은 접두사가 같아도 열리지 않는다. 유사도로 잇는 문을 만들지 않는다.
    닫힘 = propose_region_mappings(
        source_labels={1: ["서울특별/전체"], 2: ["경기남부/수원시"]}, target_labels=행안부
    )
    assert 닫힘.candidates == ()
    assert 닫힘.unmatched_source_code_value_ids == (1, 2)


def test_개편된_시도는_옛_이름과_새_이름을_모두_별칭으로_갖는다() -> None:
    # 2023 강원특별자치도·2024 전북특별자치도 개편이다. 어느 이름이 활성인지는 release가 말한다.
    assert official_sido_labels("강원") == ("강원특별자치도", "강원도")
    assert official_sido_labels("전북") == ("전북특별자치도", "전라북도")
    assert official_sido_labels("없는이름") == ()

    새_release = propose_region_mappings(
        source_labels={1: ["강원/춘천시"]},
        target_labels={30: ["강원특별자치도"], 31: ["강원특별자치도 춘천시"]},
    )
    옛_release = propose_region_mappings(
        source_labels={1: ["강원/춘천시"]},
        target_labels={30: ["강원도"], 31: ["강원도 춘천시"]},
    )
    assert [item.to_code_value_id for item in 새_release.candidates] == [31]
    assert [item.to_code_value_id for item in 옛_release.candidates] == [31]


def test_별칭_표는_열일곱_시도만_열고_값은_전부_정식명이다() -> None:
    assert len(SIDO_LABEL_ALIASES) == 17
    for 축약, 정식들 in SIDO_LABEL_ALIASES.items():
        assert len(축약) == 2
        assert 정식들
        # 축약명 자체를 정식명으로 두면 표가 있으나 마나가 된다.
        assert 축약 not in 정식들
        assert all(len(official) > len(축약) for official in 정식들)
        assert len(set(정식들)) == len(정식들)


def test_매핑없는_코드는_행_대신_미매핑_수로_보고된다() -> None:
    proposal = propose_region_mappings(
        source_labels={1: ["세종/전체"], 2: [], 3: ["서울특별시/전체"]},
        target_labels=행안부,
    )
    assert len(proposal.candidates) == 1
    assert proposal.unmatched_source_code_value_ids == (1,)
    assert proposal.source_code_value_ids_without_label == (2,)
