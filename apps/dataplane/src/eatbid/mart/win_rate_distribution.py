"""모듈 책임: 호가창이 읽는 월별 낙찰 사정률 분포를 한 build에 전량으로 다시 만든다.

회차 요약과 나눈 이유는 grain이 다르기 때문이다. 여기는 (모집단 × 코호트 × 달 × 구간)이고 저기는
회차 하나다. 두 mart는 같은 core를 읽지만 함께 바뀌지 않는다.
"""

from __future__ import annotations

from typing import Any

from eatbid.mart.derivations import DISTRIBUTION_BIN_WIDTH
from eatbid.mart.models import MartBuildPlan
from eatbid.mart.region_axis import REGION_TRANSLATION_CTE

# 코호트 키가 하나라도 비면 그 회차는 어느 분포에 속하는지 말할 수 없다. 하한율이나 낙찰 방식을
# 관측하지 못한 회차, 개찰 시각이 없는 회차, 낙찰 판정이 없는 회차는 넣지 않는다. 90과 88은 서로
# 다른 축이고 단가입찰의 사정률은 `003`과 같은 축이 아니다(AGENTS 3·6, domain-and-data §3.4).
#
# 네 모집단은 겹친다. 한 회차가 national·province·district·organization 행에 각각 1을 더하며,
# 기간 조회는 월 행을 합산한다. rolling window 열을 두지 않는다.
WIN_RATE_DISTRIBUTION_FILL_SQL = f"""
insert into mart.win_rate_distribution_monthly (
  build_id, scope, region_code_value_id, organization_id,
  floor_rate, award_method_code_value_id, month_kst, bin_lower, bin_width, attempt_count
)
with {REGION_TRANSLATION_CTE.strip()},
latest as (
  select distinct on (revision.auction_attempt_id)
         revision.auction_revision_id,
         revision.auction_attempt_id,
         revision.opened_at,
         revision.floor_rate
    from core.auction_revision as revision
   order by revision.auction_attempt_id, revision.auction_revision_id desc
),
rounds as (
  select purchaser.organization_id,
         -- 선언한 체계로 번역되지 않는 지역은 null이 되어 지역 모집단에서 빠진다. 전국·기관 모집단은
         -- 지역 축이 없으므로 그 회차를 계속 센다.
         province_axis.region_code_value_id as province_code_value_id,
         district_axis.region_code_value_id as district_code_value_id,
         latest.floor_rate,
         award_method.code_value_id as award_method_code_value_id,
         date_trunc('month', latest.opened_at at time zone 'Asia/Seoul')::date as month_kst,
         -- 반개구간 `[bin_lower, bin_lower + bin_width)`다. 사정률이 numeric이라 정확 연산이다.
         floor(award.awarded_rate / %(bin_width)s::numeric) * %(bin_width)s::numeric as bin_lower
    from latest
    join core.award_decision as award
      on award.auction_revision_id = latest.auction_revision_id
    join core.auction_organization as purchaser
      on purchaser.auction_revision_id = latest.auction_revision_id
     and purchaser.role = 'purchaser'
    join core.auction_revision_code_value as award_method
      on award_method.auction_revision_id = latest.auction_revision_id
     and award_method.role = 'award_method'
    left join core.auction_revision_code_value as sido
      on sido.auction_revision_id = latest.auction_revision_id
     and sido.role = 'location_sido'
    left join core.auction_revision_code_value as sigungu
      on sigungu.auction_revision_id = latest.auction_revision_id
     and sigungu.role = 'location_sigungu'
    left join region_translation as province_axis
      on province_axis.source_code_value_id = sido.code_value_id
    left join region_translation as district_axis
      on district_axis.source_code_value_id = sigungu.code_value_id
   where latest.opened_at is not null
     and latest.floor_rate is not null
),
populations as (
  select 'national'::varchar(16) as scope, null::bigint as region_code_value_id,
         null::bigint as organization_id,
         floor_rate, award_method_code_value_id, month_kst, bin_lower
    from rounds
  union all
  select 'province', province_code_value_id, null::bigint,
         floor_rate, award_method_code_value_id, month_kst, bin_lower
    from rounds
   where province_code_value_id is not null
  union all
  select 'district', district_code_value_id, null::bigint,
         floor_rate, award_method_code_value_id, month_kst, bin_lower
    from rounds
   where district_code_value_id is not null
  union all
  select 'organization', null::bigint, organization_id,
         floor_rate, award_method_code_value_id, month_kst, bin_lower
    from rounds
)
select
  %(build_id)s::bigint,
  scope,
  region_code_value_id,
  organization_id,
  floor_rate,
  award_method_code_value_id,
  month_kst,
  bin_lower,
  %(bin_width)s::numeric,
  count(*)
from populations
group by scope, region_code_value_id, organization_id, floor_rate,
         award_method_code_value_id, month_kst, bin_lower
"""


def fill_win_rate_distribution(
    connection: Any, *, plan: MartBuildPlan, build_id: int
) -> int:
    """이 build에 월별 낙찰 사정률 분포를 전량 적재하고 적재한 행 수를 돌려준다."""
    with connection.cursor() as cursor:
        cursor.execute(
            WIN_RATE_DISTRIBUTION_FILL_SQL,
            {
                "build_id": build_id,
                "bin_width": DISTRIBUTION_BIN_WIDTH,
                "region_scheme": plan.region_scheme,
            },
        )
        return cursor.rowcount
