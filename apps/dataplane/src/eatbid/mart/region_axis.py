"""모듈 책임: mart build의 지역 축을 선언한 코드 체계로 번역하고 그 체계 밖의 코드를 세어 막는다.

빌더 계산 규칙과 나눈 이유는 "무엇을 세는가"와 "그 수를 어느 체계의 지역에 귀속시키는가"가 서로 다른
결정이기 때문이다. 체계 전환은 새 `calc_version`의 새 build이며 한 build는 한 체계다(ADR 0034·0035).
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from eatbid.core.region_mapping import EXACT_RELATION
from eatbid.mart.models import MartBuildPlan, MartName
from eatbid.mart.repository import MartBuildContractError

# 번역 CTE다. 선언한 체계의 코드는 그대로 통과하고, 다른 체계의 코드는 `core.code_mapping`의
# `exact` 행이 **유일할 때만** 번역된다.
#
# `overlaps`를 번역하지 않는 이유: 그것은 등가 주장이 아니라 한 코드가 두 구역에 걸쳐 있다는 사실이다.
# 번역하면 한 회차가 두 지역의 분포에 동시에 들어가 표본 수가 부풀고, 그 지역의 사용자는 자기 지역에서
# 일어나지 않은 회차를 본다. 유일하지 않은 대응도 같은 이유로 번역하지 않는다(ADR 0035 결정 6).
# 번역되지 않은 코드는 null이 되고 호출부가 그 행을 지역 모집단에서 뺀다 — 매핑 없음은 행의 부재다.
#
# 강제 조건: 선언한 체계에 **code release가 있을 때만** 축을 그 체계로 강제한다. eaT 관측 축은
# 시도와 시군구가 서로 다른 scheme이라 한 이름으로 묶이지 않으므로, release가 없는 체계를 선언한
# build는 전환 이전 상태이며 관측된 코드를 그대로 싣는다. 정부 release가 적재되고 그 체계를 선언한
# build가 나오는 순간부터 번역과 검증이 함께 켜진다 — 전환이 침묵하지 않는다(ADR 0034·0035).
REGION_TRANSLATION_CTE = f"""
region_axis_enforced as (
  select exists (
    select 1
      from core.code_release as release
      join core.code_scheme as scheme
        on scheme.code_scheme_id = release.code_scheme_id
     where scheme.namespace = %(region_scheme)s
  ) as enforced
),
region_translation as (
  select value.code_value_id as source_code_value_id,
         case
           when not region_axis_enforced.enforced then value.code_value_id
           when scheme.namespace = %(region_scheme)s then value.code_value_id
           else mapped.target_code_value_id
         end as region_code_value_id
    from core.code_value as value
    join core.code_scheme as scheme
      on scheme.code_scheme_id = value.code_scheme_id
    cross join region_axis_enforced
    left join (
      select mapping.from_code_value_id as source_code_value_id,
             min(mapping.to_code_value_id) as target_code_value_id
        from core.code_mapping as mapping
        join core.code_value as target
          on target.code_value_id = mapping.to_code_value_id
        join core.code_scheme as target_scheme
          on target_scheme.code_scheme_id = target.code_scheme_id
       where target_scheme.namespace = %(region_scheme)s
         and mapping.relation = '{EXACT_RELATION}'
       group by mapping.from_code_value_id
      having count(distinct mapping.to_code_value_id) = 1
    ) as mapped
      on mapped.source_code_value_id = value.code_value_id
)
"""

# build_id를 가진 mart 표에서 지역 코드 값을 싣는 열이다. 새 지역 열이 생기면 이 표와 검증이 함께
# 움직여야 전환이 침묵하지 않는다.
REGION_COLUMNS: Mapping[MartName, tuple[tuple[str, str], ...]] = {
    "win_rate_distribution_monthly": (
        ("mart.win_rate_distribution_monthly", "region_code_value_id"),
    ),
    "open_auction_snapshot": (
        ("mart.open_auction_snapshot", "region_sido_code_value_id"),
        ("mart.open_auction_snapshot", "region_sigungu_code_value_id"),
    ),
    "org_round_summary": (),
}

_REGION_AXIS_ENFORCED_SQL = """
select exists (
  select 1
    from core.code_release as release
    join core.code_scheme as scheme
      on scheme.code_scheme_id = release.code_scheme_id
   where scheme.namespace = %(region_scheme)s
)
"""

_FOREIGN_SCHEME_COUNT_SQL = """
select count(*)
  from {table} as target
  join core.code_value as value
    on value.code_value_id = target.{column}
  join core.code_scheme as scheme
    on scheme.code_scheme_id = value.code_scheme_id
 where target.build_id = %(build_id)s
   and scheme.namespace <> %(region_scheme)s
"""

_UNMAPPED_REGION_CODE_SQL = f"""
with {REGION_TRANSLATION_CTE.strip()}
select count(*)
  from (
    select distinct observed.code_value_id
      from core.auction_revision_code_value as observed
     where observed.role in ('location_sido', 'location_sigungu')
  ) as region_code
  join region_translation
    on region_translation.source_code_value_id = region_code.code_value_id
 where region_translation.region_code_value_id is null
"""


def _region_axis_enforced(cursor: Any, region_scheme: str) -> bool:
    """선언한 체계에 code release가 있는가. 없으면 전환 이전이라 관측 축을 그대로 둔다."""
    cursor.execute(_REGION_AXIS_ENFORCED_SQL, {"region_scheme": region_scheme})
    row = cursor.fetchone()
    return bool(row is not None and row[0])


def assert_build_region_scheme(
    connection: Any, *, plan: MartBuildPlan, build_id: int
) -> None:
    """이 build가 쓴 지역 코드가 전부 선언한 체계에 속하는지 질의로 확인한다.

    행 수를 고정하기 전에 확인해야 한다. 통과하지 못한 build를 활성으로 올리면 화면이 한 사다리에서
    두 체계의 지역을 함께 읽고, 그 사실은 어디에도 기록되지 않는다(설계 §6 전환의 불변식).
    """
    if plan.region_scheme is None:
        return
    with connection.cursor() as cursor:
        if not _region_axis_enforced(cursor, plan.region_scheme):
            return
        for table, column in REGION_COLUMNS.get(plan.mart_name, ()):
            cursor.execute(
                _FOREIGN_SCHEME_COUNT_SQL.format(table=table, column=column),
                {"build_id": build_id, "region_scheme": plan.region_scheme},
            )
            row = cursor.fetchone()
            foreign = 0 if row is None else int(row[0])
            if foreign:
                raise MartBuildContractError(
                    "mart build wrote region codes outside its declared scheme "
                    f"[build_id={build_id} column={column} rows={foreign}]"
                )


def count_unmapped_region_codes(connection: Any, *, plan: MartBuildPlan) -> int:
    """선언한 체계로 번역되지 않는 관측 지역 코드 수다.

    0이 아니면 그 지역의 회차가 지역 모집단에서 빠진다. 결함이 아니라 정부가 대조표를 주지 않은
    구간이며, 숨기지 않고 세어 coverage 문서와 실행 로그가 읽는다(ADR 0035 Consequences).
    """
    if plan.region_scheme is None:
        return 0
    with connection.cursor() as cursor:
        cursor.execute(_UNMAPPED_REGION_CODE_SQL, {"region_scheme": plan.region_scheme})
        row = cursor.fetchone()
        return 0 if row is None else int(row[0])
