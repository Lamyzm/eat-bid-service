"""모듈 책임: eaT가 한 문자열로 준 품목 라벨을 원자 목록과 미매핑 조각으로 가르고, 둘을 섞지 않는다."""

from __future__ import annotations

from dataclasses import dataclass

from eatbid.source.eat.code_schemes import AUCTION_ITEM_ATOMS

_SEPARATOR = ","

_KNOWN = frozenset(AUCTION_ITEM_ATOMS)


@dataclass(frozen=True, slots=True)
class AuctionItemReading:
    """라벨 하나를 읽은 결과다.

    `atoms`와 `unmapped`를 한 값에 담는 이유는 둘이 같은 읽기의 두 면이기 때문이다. 미매핑을 그냥
    버리면 우리 어휘가 원천을 못 따라간 사실이 사라지고, 미매핑을 원자에 섞으면 없던 범주가 생긴다
    (AGENTS 3). 호출자는 둘 다 받고 무엇을 저장하고 무엇을 드러낼지 각자 정한다.
    """

    atoms: tuple[str, ...]
    unmapped: tuple[str, ...]


def read_item_label(label: str | None) -> AuctionItemReading:
    """품목 라벨을 원자로 읽는다. 라벨이 없으면 두 값 모두 비어 있으며 그것은 실패가 아니다.

    쪼개기 규칙이 우리의 발명이 아니라는 근거는 전수 실측이다 — 과거 89,576 revision 중 라벨이 있는
    59,766건에서 구분자가 언제나 공백·쉼표·공백이고, 한글과 쉼표와 공백 밖의 문자도 빈 조각도 양끝
    공백도 하나도 없으며, 쪼갠 90,906개 조각이 정확히 여덟 원자로 닫힌다(2026-09-16).

    그래도 쪼갠 조각을 무조건 원자로 받지 않는다. 원천이 아홉째 낱말을 보내기 시작하면 그것은 우리가
    모르는 범주이고, 조용히 통과시키면 없던 원자가 생긴 것을 아무도 모른다.

    라벨 자체는 여기서 버리지 않는다 — 원본은 normalized record에 그대로 남아 있고 이 함수는 해석만
    돌려준다. 그래서 어휘가 늘면 재수집 없이 재투영으로 고칠 수 있다.
    """
    if label is None:
        return AuctionItemReading(atoms=(), unmapped=())
    atoms: list[str] = []
    unmapped: list[str] = []
    for part in label.split(_SEPARATOR):
        term = part.strip()
        if not term:
            continue
        # 같은 원자가 두 번 적힌 라벨은 실측에 없지만, 생기면 code_value 한 쌍에 두 번 붙는 것을
        # 막아야 한다. 저장이 중복을 거부하기 전에 여기서 한 번만 남긴다.
        target = atoms if term in _KNOWN else unmapped
        if term not in target:
            target.append(term)
    return AuctionItemReading(atoms=tuple(atoms), unmapped=tuple(unmapped))
