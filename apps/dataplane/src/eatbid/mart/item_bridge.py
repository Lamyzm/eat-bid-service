"""모듈 책임: mart 빌더가 관측 품목 라벨을 원자 다리표 행으로 옮기고 어휘 밖 조각을 build마다 세는 한 규칙을 소유한다.

스냅샷(`open_auction_snapshot_item`)과 회차 요약(`org_round_summary_item`)이 같은 함수를 부르지 않으면 어느 날
둘이 다른 원자를 만든다(EAT-230·256). 쪼개기와 미매핑 격리의 규칙 자체는 `read_item_label` 하나가 소유하고
core 투영도 같은 함수를 쓴다.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Iterable
from typing import Any

from eatbid.core.auction_items import read_item_label
from eatbid.source.eat.code_schemes import AUCTION_ITEM_SCHEME

# 같은 build에 다시 돌리면 같은 조각이 같은 수로 나오므로 덮어쓴다 — 재개한 빌드가 격리 수를 두 배로 만들지 않는다.
_INSERT_VOCABULARY_GAP_SQL = """
insert into mart.build_vocabulary_gap (build_id, scheme_namespace, fragment, row_count)
values (%(build_id)s, %(namespace)s, %(fragment)s, %(row_count)s)
on conflict on constraint build_vocabulary_gap_pkey
do update set row_count = excluded.row_count
"""


def fill_item_bridge(
    cursor: Any, *, build_id: int, rows: Iterable[tuple[Any, str]], insert_sql: str
) -> None:
    """(행 키, 라벨) 마다 원자 코드를 다리표에 넣고 어휘 밖 조각을 센다.

    `insert_sql`은 `%(build_id)s`·`%(key)s`·`%(namespace)s`·`%(code)s`를 받으며 체계 이름으로 코드를 닫아야
    한다 — 코드 문자열은 여러 체계에 있을 수 있어 체계 없이 조인하면 다른 어휘의 같은 글자를 잡는다(AGENTS 2·6).
    시드가 안 심은 원자는 행이 안 생기며 그것은 빌더가 어휘를 지어내지 않는다는 뜻이다. 미매핑 조각은 행을
    만들지 않는 대신 여기서 센다 — 세지 않으면 원천이 아홉째 낱말을 보내기 시작한 날 그 행은 조용히
    `품목 미상`이 되고 아무도 모른다(AGENTS 3, EAT-255).
    """
    gap: Counter[str] = Counter()
    for key, label in rows:
        reading = read_item_label(label)
        for atom in reading.atoms:
            cursor.execute(
                insert_sql,
                {"build_id": build_id, "key": key, "namespace": AUCTION_ITEM_SCHEME, "code": atom},
            )
        gap.update(reading.unmapped)
    for fragment, row_count in sorted(gap.items()):
        cursor.execute(
            _INSERT_VOCABULARY_GAP_SQL,
            {
                "build_id": build_id,
                "namespace": AUCTION_ITEM_SCHEME,
                "fragment": fragment,
                "row_count": row_count,
            },
        )
