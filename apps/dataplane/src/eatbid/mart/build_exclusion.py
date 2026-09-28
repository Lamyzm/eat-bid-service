"""모듈 책임: 발행 제외 원장(`ingest.publication_exclusion`)에서 한 build가 싣는 제외 사실 두 가지 — 달별 제외 공고 수와
최신 관측이 반영되지 않은 공고 — 를 파생해 `mart.build_exclusion_month`·`mart.build_stale_auction`에 적는다.

왜 dataplane이 파생하는가: 서버는 core·mart만 읽는다(`eatbid_api`에 ingest 권한이 없다). 원장과 관측 수신 시각은
ingest에만 있으므로 화면이 제외를 말하려면 mart 빌더가 build마다 옮겨 실어야 한다(ADR 0061 결정 5·6, EAT-295).

보유율(`build_coverage`)과 달리 이 build의 release만이 아니라 **원장 전체**를 읽는다. 제외는 발행마다 쌓이고 뒤의
재파싱이 해소하는 누적 상태라, 이 build를 촉발한 release만 보면 다른 창의 미해소 제외가 화면에서 사라진다.
원장은 발행당 최대 50행(ADR 0061 결정 3)이라 전량 읽기가 build 비용을 바꾸지 않는다.
"""

from __future__ import annotations

from typing import Any

from eatbid.mart.models import MartBuildPlan
from eatbid.source.eat.registry import require

# 상세 요청 매개변수의 공고 식별자와 목록 창의 시작일이다. `ingest.backfill_coverage`가 같은 두 경로로 공고와
# 창을 세므로, 달 귀속이 그 뷰와 어긋나지 않도록 같은 이름을 쓴다.
DETAIL_BID_PARAM = "ELCTRN_BID_ID"
WINDOW_START_PARAM = "P_BID_BGNG_DT"

# 발행된(published) 발행의 원장 행만 제외다. 실패한 발행의 원장은 공개되지 않은 시도의 기록일 뿐이다.
# 해소 판정은 `ingest.backfill_coverage`의 `excluded_observation`과 같다 — 그 관측의 정규화 레코드 하나라도
# revision을 얻었으면 해소다. 두 자리가 다르게 판정하면 운영 기대와 화면이 서로 다른 수를 말한다.
_EXCLUDED_OBSERVATIONS = f"""
excluded as (
  select distinct e.observation_id
    from ingest.publication_exclusion e
    join ingest.publication p
      on p.publication_id = e.publication_id and p.status = 'published'
),
observation as (
  select x.observation_id,
         o.source,
         o.request_params ->> '{DETAIL_BID_PARAM}' as external_bid_id,
         o.fetched_at,
         o.run_id,
         exists (
           select 1
             from ingest.normalized_record nr
             join core.auction_revision rev on rev.normalized_record_id = nr.normalized_record_id
            where nr.observation_id = x.observation_id
         ) as resolved
    from excluded x
    join ingest.raw_observation o on o.observation_id = x.observation_id
)
"""

BUILD_EXCLUSION_MONTH_FILL_SQL = f"""
insert into mart.build_exclusion_month (
  build_id, month_kst, excluded_auction_count, unresolved_auction_count
)
with {_EXCLUDED_OBSERVATIONS},
-- 관측이 어느 달의 것인가는 그 관측을 받은 run이 속한 release의 목록 창이 말한다. 한 release가 여러 창을 덮으면
-- 가장 이른 창의 달로 한 번만 센다 — 여러 달에 나눠 세면 한 공고가 두 번 빠진 것처럼 보인다.
observation_month as (
  select ob.observation_id,
         min(date_trunc('month', to_date(u.request_params ->> '{WINDOW_START_PARAM}', 'YYYYMMDD')))::date
           as month_kst
    from observation ob
    join ingest.source_release_run own on own.run_id = ob.run_id
    join ingest.source_release_run member on member.source_release_id = own.source_release_id
    join ingest.request_unit u
      on u.run_id = member.run_id
     and u.endpoint = %(list_endpoint)s
     and u.request_params ? '{WINDOW_START_PARAM}'
   group by ob.observation_id
),
-- 세는 단위는 관측이 아니라 공고다. 같은 공고가 매시 수집에서 거듭 제외되면 관측은 늘어도 빠진 공고는 하나다.
-- 식별자가 없는 관측은 공고로 묶을 수 없으므로 관측 하나를 한 건으로 센다(과소 계상보다 드러내는 쪽).
per_auction as (
  select m.month_kst,
         bool_or(not ob.resolved) as unresolved
    from observation ob
    join observation_month m on m.observation_id = ob.observation_id
   group by m.month_kst, ob.source, ob.external_bid_id,
            case when ob.external_bid_id is null then ob.observation_id end
)
select %(build_id)s::bigint,
       month_kst,
       count(*),
       count(*) filter (where unresolved)
  from per_auction
 group by month_kst
"""

# "최신 관측 반영 안 됨"의 정의(ADR 0061 결정 5 마지막 항): 이미 revision이 있는 공고에서, 해소되지 않은 제외
# 관측이 현행 revision의 관측보다 늦게 받은 것일 때다. 현행은 서버 공고 조회와 같은 규칙(revision id가 가장 큰
# 것)이다. 제외 관측이 현행보다 이르면 그 뒤에 받은 관측이 이미 반영된 것이므로 표시하지 않는다.
BUILD_STALE_AUCTION_FILL_SQL = f"""
insert into mart.build_stale_auction (
  build_id, auction_attempt_id, auction_revision_id, excluded_observed_at, reflected_observed_at
)
with {_EXCLUDED_OBSERVATIONS}
select %(build_id)s::bigint,
       attempt.auction_attempt_id,
       current_revision.auction_revision_id,
       max(ob.fetched_at),
       current_revision.fetched_at
  from observation ob
  join core.auction_attempt attempt
    on attempt.source_system = ob.source
   and attempt.external_bid_id = ob.external_bid_id
  join lateral (
    select rev.auction_revision_id, reflected.fetched_at
      from core.auction_revision rev
      join ingest.raw_observation reflected on reflected.observation_id = rev.observation_id
     where rev.auction_attempt_id = attempt.auction_attempt_id
     order by rev.auction_revision_id desc
     limit 1
  ) current_revision on true
 where not ob.resolved
   and ob.fetched_at > current_revision.fetched_at
 group by attempt.auction_attempt_id, current_revision.auction_revision_id, current_revision.fetched_at
"""


def fill_build_exclusions(
    connection: Any, *, plan: MartBuildPlan, build_id: int
) -> None:
    """이 build의 제외 부속 행을 적재한다.

    행 수는 mart의 `row_count` 검증에 쓰이지 않는다. 보유율처럼 지표를 어떻게 읽어야 하는지를 말하는 부속
    사실이라 mart 표의 표본 수와 같은 자리에서 세지 않는다.
    """
    list_endpoint = require("bid-list", parser_version=plan.parser_version).endpoint
    with connection.cursor() as cursor:
        cursor.execute(
            BUILD_EXCLUSION_MONTH_FILL_SQL,
            {"build_id": build_id, "list_endpoint": list_endpoint},
        )
        cursor.execute(BUILD_STALE_AUCTION_FILL_SQL, {"build_id": build_id})
