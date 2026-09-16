"""모듈 책임: 회차 1행 요약 mart를 한 build에 전량으로 다시 만드는 계산 규칙을 소유한다.

행 단위 증분을 만들지 않는 이유는 ADR 0034에 있다. 전량 빌드가 결정적이고, 검증이 행 수와 표본
합계 하나로 끝나며, 실측이 그 비용을 감당한다.

파생 규칙의 사람이 읽는 정의는 `derivations.py`에 있다. 여기 SQL이 그 정의와 갈라지지 않는지는
통합 test가 같은 입력의 두 결과를 맞대어 확인한다.
"""

from __future__ import annotations

from typing import Any

from eatbid.mart.item_bridge import fill_item_bridge
from eatbid.mart.models import MartBuildPlan

# 한 attempt의 "최신 revision"은 `auction_revision_id` 최대값이다. 관측 시각으로 고르지 않는 이유는
# 같은 raw의 replay가 시각을 되돌릴 수 있기 때문이고, revision id는 identity라 append 순서로 단조롭다.
#
# revision이 0개인 attempt는 행을 만들지 않는다. 관계로만 알려진 공고를 회차로 발표하면 안 된다.
# 공고 시각이나 기초금액을 관측하지 못한 revision도 제외한다 — 화면의 회차 표는 그 둘을 요구하고,
# 없는 값을 추측으로 메우지 않는다(AGENTS 3).
#
# 예정가격은 "관측됐다"의 기준이 `is not null`이 아니라 `> 0`이다. eaT는 추첨 전 공고의
# `ELCTRN_BID_PLNPRC`를 빈 값이 아니라 `0`으로 보내고, 정규화는 관측을 보존하므로 core에는 `0.00`이
# 앉는다(EAT-74 운영 실측). 그 0은 금액이 아니라 "아직 추첨하지 않음"이며, 그 위에 그날 하한을
# 계산하면 `0.0000`이라는 거짓 하한이 생긴다. 그래서 회차 행의 `planned_amount`는 관측 그대로 싣되
# 예정가격에서 파생하는 값 — 그날 하한 금액·비율, 투찰률 축 낙찰률, 하한 미만 수 — 은 전부 null로
# 둔다. 하한 미만 수까지 비우는 이유는 명단의 사정률이 예정가격 분모의 소스 계산값이라 예정가격이
# 없는 회차에서는 그 부등식 자체가 성립하지 않기 때문이다(derivations.py).
ORG_ROUND_SUMMARY_FILL_SQL = """
insert into mart.org_round_summary (
  build_id, auction_attempt_id, auction_revision_id, organization_id,
  item_label, announced_at, opened_at, floor_rate,
  award_method_code_value_id, base_amount, planned_amount, currency,
  awarded_assessment_rate, runner_up_assessment_rate,
  day_floor_amount, day_floor_bid_rate, awarded_bid_rate,
  list_count, below_day_floor_count, withdrawn_count, withdrawal_cohort_age_days,
  winner_supplier_party_id, supersedes_attempt_id, lineage_status, opened_month_kst
)
with latest as (
  select distinct on (revision.auction_attempt_id)
         revision.auction_revision_id,
         revision.auction_attempt_id,
         revision.announced_at,
         revision.opened_at,
         revision.floor_rate,
         revision.base_amount,
         revision.planned_amount,
         revision.currency,
         revision.source_payload
    from core.auction_revision as revision
   order by revision.auction_attempt_id, revision.auction_revision_id desc
),
roster as (
  select latest.auction_revision_id,
         count(*) as list_count,
         count(*) filter (
           where latest.floor_rate is not null and submission.bid_rate < latest.floor_rate
         ) as below_day_floor_count,
         count(*) filter (where withdrawal.code = 'Y') as withdrawn_count
    from latest
    join core.bid_submission as submission
      on submission.auction_revision_id = latest.auction_revision_id
    left join core.code_value as withdrawal
      on withdrawal.code_value_id = submission.withdrawal_code_value_id
   group by latest.auction_revision_id
)
select
  %(build_id)s::bigint,
  latest.auction_attempt_id,
  latest.auction_revision_id,
  purchaser.organization_id,
  -- 관측 라벨은 그대로 싣는다. 원자 코드는 열이 아니라 다리표 `org_round_summary_item`이며 `_fill_items`가
  -- 같은 라벨을 `read_item_label`로 읽어 채운다(EAT-256).
  nullif(btrim(coalesce(
    latest.source_payload #>> '{classification,sourceCategoryLabel}', ''
  )), ''),
  latest.announced_at,
  latest.opened_at,
  latest.floor_rate,
  award_method.code_value_id,
  latest.base_amount,
  latest.planned_amount,
  latest.currency,
  award.awarded_rate,
  award.runner_up_rate,
  case
    when latest.floor_rate is not null and latest.planned_amount > 0
    then floor(latest.floor_rate / 100 * latest.planned_amount * 100) / 100
  end,
  case
    when latest.floor_rate is not null and latest.planned_amount > 0
         and latest.base_amount > 0
    then round(latest.floor_rate * latest.planned_amount / latest.base_amount, 4)
  end,
  case
    when award.awarded_rate is not null and latest.planned_amount > 0
         and latest.base_amount > 0
    then round(award.awarded_rate * latest.planned_amount / latest.base_amount, 4)
  end,
  roster.list_count,
  case
    when latest.floor_rate is not null and latest.planned_amount > 0
    then roster.below_day_floor_count
  end,
  roster.withdrawn_count,
  case
    when latest.opened_at is not null
    then (
      (%(as_of)s::timestamptz at time zone 'Asia/Seoul')::date
      - (latest.opened_at at time zone 'Asia/Seoul')::date
    )
  end,
  award.supplier_party_id,
  parent.to_auction_attempt_id,
  -- `lineage` 블록이 있는 계약으로 정규화된 회차만 사슬을 관측한 것이다. 그 블록이 없는 계약의
  -- 회차는 "사슬 없음"이 아니라 "모름"이며, 둘을 한 값으로 숨기지 않는다.
  case when latest.source_payload ? 'lineage' then 'observed' else 'unknown' end,
  case
    when latest.opened_at is not null
    then date_trunc('month', latest.opened_at at time zone 'Asia/Seoul')::date
  end
from latest
join core.auction_organization as purchaser
  on purchaser.auction_revision_id = latest.auction_revision_id
 and purchaser.role = 'purchaser'
left join roster on roster.auction_revision_id = latest.auction_revision_id
left join core.award_decision as award
  on award.auction_revision_id = latest.auction_revision_id
left join core.auction_revision_code_value as award_method
  on award_method.auction_revision_id = latest.auction_revision_id
 and award_method.role = 'award_method'
left join lateral (
  select link.to_auction_attempt_id
    from core.auction_attempt_link as link
   where link.auction_revision_id = latest.auction_revision_id
     and link.relation = 'parent'
   order by link.auction_attempt_link_id
   limit 1
) as parent on true
where latest.announced_at is not null
  and latest.base_amount is not null
"""


# 이 build의 요약 행 가운데 라벨이 있는 것만 읽는다. 라벨 없는 행은 원자도 없고 그것은 "품목 미상"이다.
_ITEM_LABEL_ROWS_SQL = """
select auction_attempt_id, item_label
  from mart.org_round_summary
 where build_id = %(build_id)s and item_label is not null
 order by auction_attempt_id
"""

_INSERT_SUMMARY_ITEM_SQL = """
insert into mart.org_round_summary_item (build_id, auction_attempt_id, item_code_value_id)
select %(build_id)s, %(key)s, value.code_value_id
  from core.code_value as value
  join core.code_scheme as scheme on scheme.code_scheme_id = value.code_scheme_id
 where scheme.namespace = %(namespace)s and value.code = %(code)s
on conflict do nothing
"""


def fill_org_round_summary(
    connection: Any, *, plan: MartBuildPlan, build_id: int
) -> int:
    """이 build에 회차 요약을 전량 적재하고 적재한 행 수를 돌려준다.

    품목 다리표는 요약 행 수를 바꾸지 않으므로 `verify_build`의 표본 검증과 어긋나지 않는다.
    """
    with connection.cursor() as cursor:
        cursor.execute(
            ORG_ROUND_SUMMARY_FILL_SQL,
            {"build_id": build_id, "as_of": plan.as_of},
        )
        row_count = cursor.rowcount
        _fill_items(cursor, build_id=build_id)
        return row_count


def _fill_items(cursor: Any, *, build_id: int) -> None:
    """라벨 한 문자열을 원자 코드 여러 행으로 옮겨 다리표를 채운다. 규칙은 스냅샷 빌더와 같은 함수다(EAT-256)."""
    cursor.execute(_ITEM_LABEL_ROWS_SQL, {"build_id": build_id})
    rows = [(int(attempt_id), label) for attempt_id, label in cursor.fetchall()]
    fill_item_bridge(cursor, build_id=build_id, rows=rows, insert_sql=_INSERT_SUMMARY_ITEM_SQL)
