"""모듈 책임: 한 build가 읽은 (지역, 달) 구간의 모집단 보유율을 `mart.build_coverage`에 적는다.

mart 행의 계산 규칙과 함께 바뀌지 않는다. 여기서 바뀌는 것은 "그 수를 이 grain에 귀속시킬 수
있는가"라는 판정뿐이고 mart 빌더는 "무엇을 세는가"를 소유한다.

분모의 자리(설계 §5). 시도·월별 분모가 실제로 사는 곳은 `ingest.request_unit`의 목록 요청 매개변수다.
`ingest.source_release_dataset`은 grain이 `(source_release_id, dataset)`이라 축이 없다. 그래서 축은
목록 요청 단위가, 수는 봉인된 release의 상세 dataset이 말한다.

`none`은 이 빌더가 적지 않는다. "그 (지역, 달)을 덮는 요청 단위가 없다"는 사실은 (지역 × 달)의
전체 모집단을 열거해야 행으로 쓸 수 있는데 그 모집단은 화면의 코호트가 정하지 우리가 정하지 않는다.
행이 없다는 것이 `none`이며 그 번역은 읽기 경로가 한다.
"""

from __future__ import annotations

from typing import Any

from eatbid.mart.models import MartBuildPlan
from eatbid.source.eat.registry import require

# 목록 요청 매개변수의 이름은 검토된 입력 계약이 소유한다. 여기서는 그 계약이 이미 저장한 jsonb의
# 경로로만 읽으므로 Nexacro field 이름 셋이 이 판정의 축이다.
REGION_PARAM = "P_CTPV_CD"
WINDOW_START_PARAM = "P_BID_BGNG_DT"
WINDOW_END_PARAM = "P_BID_END_DT"

BUILD_COVERAGE_FILL_SQL = f"""
insert into mart.build_coverage (
  build_id, region_code_value_id, month_kst,
  expected_count, observed_count, normalized_count, quarantined_count, coverage
)
with windows as (
  select distinct
         nullif(btrim(unit.request_params ->> '{REGION_PARAM}'), '') as region_code,
         to_date(unit.request_params ->> '{WINDOW_START_PARAM}', 'YYYYMMDD') as window_start,
         to_date(unit.request_params ->> '{WINDOW_END_PARAM}', 'YYYYMMDD') as window_end
    from ingest.source_release_run as member
    join ingest.request_unit as unit
      on unit.run_id = member.run_id
   where member.source_release_id = %(source_release_id)s
     and unit.endpoint = %(list_endpoint)s
     and unit.request_params ? '{WINDOW_START_PARAM}'
     and unit.request_params ? '{WINDOW_END_PARAM}'
),
corpus as (
  select coalesce(sum(dataset.expected_count), 0) as expected_count,
         coalesce(sum(dataset.observed_count), 0) as observed_count,
         coalesce(sum(dataset.normalized_count), 0) as normalized_count,
         coalesce(sum(dataset.quarantined_count), 0) as quarantined_count
    from ingest.source_release_dataset as dataset
   where dataset.source_release_id = %(source_release_id)s
     and dataset.dataset = %(detail_dataset)s
),
grain as (
  select region.code_value_id as region_code_value_id,
         generate_series(
           date_trunc('month', windows.window_start),
           date_trunc('month', windows.window_end),
           interval '1 month'
         )::date as month_kst,
         -- 축이 없거나(지역 매개변수가 비어 있다), 이 build의 코드 체계로 그 코드를 못 읽거나,
         -- 창이 한 달을 넘으면 release의 수를 이 grain에 귀속시킬 수 없다.
         windows.region_code is null
           or region.code_value_id is null
           or date_trunc('month', windows.window_start)
              <> date_trunc('month', windows.window_end) as unattributable
    from windows
    left join core.code_scheme as scheme
      on scheme.namespace = %(region_scheme)s
    left join core.code_value as region
      on region.code_scheme_id = scheme.code_scheme_id
     and region.code = windows.region_code
),
grain_count as (
  select count(*) as grains
    from (select distinct region_code_value_id, month_kst from grain) as distinct_grain
)
select %(build_id)s::bigint,
       grain.region_code_value_id,
       grain.month_kst,
       corpus.expected_count,
       corpus.observed_count,
       corpus.normalized_count,
       corpus.quarantined_count,
       case
         -- release가 여러 grain을 덮으면 그 수를 어느 grain의 것으로도 셀 수 없다. 나눠 담은 척하면
         -- 화면이 "일부 수집됨"이라고 거짓말한다(AGENTS 3).
         when grain_count.grains > 1 or bool_or(grain.unattributable) then 'unknown'
         when corpus.observed_count = corpus.expected_count
              and corpus.normalized_count + corpus.quarantined_count = corpus.observed_count
              and corpus.quarantined_count = 0 then 'complete'
         else 'partial'
       end
  from grain
 cross join corpus
 cross join grain_count
 group by grain.region_code_value_id, grain.month_kst, grain_count.grains,
          corpus.expected_count, corpus.observed_count,
          corpus.normalized_count, corpus.quarantined_count
"""


def fill_build_coverage(connection: Any, *, plan: MartBuildPlan, build_id: int) -> int:
    """이 build의 보유율 행을 전량 다시 적재하고 적재한 행 수를 돌려준다.

    반환값은 mart의 `row_count` 검증에 쓰이지 않는다. 보유율은 지표가 아니라 그 지표를 어디까지
    믿어도 되는지를 말하는 부속 사실이라 mart 표의 표본 수와 같은 자리에서 세지 않는다.
    """
    list_endpoint = require("bid-list", parser_version=plan.parser_version).endpoint
    detail_dataset = require(
        "bid-detail", parser_version=plan.parser_version
    ).response_datasets[0]
    with connection.cursor() as cursor:
        cursor.execute(
            BUILD_COVERAGE_FILL_SQL,
            {
                "build_id": build_id,
                "source_release_id": plan.source_release_id,
                "list_endpoint": list_endpoint,
                "detail_dataset": detail_dataset,
                "region_scheme": plan.region_scheme,
            },
        )
        return cursor.rowcount
