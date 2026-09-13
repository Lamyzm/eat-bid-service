"""모듈 책임: 봉인된 release의 목록 관측을 R2에서 다시 읽어 열린 공고 스냅샷 mart를 만든다.

다른 두 mart와 달리 입력이 PostgreSQL에 없다. 목록 행은 normalized record가 되지 않고 원본 페이지만
R2에 남기 때문이다. 그래서 검토된 목록 파서를 그대로 다시 써서 스냅샷을 만든다 — 새 record type도
새 core 표도 만들지 않으며, replay가 하는 것과 같은 모양이다(ADR 0034 §입력).

목록에만 있고 아직 상세를 따지 않은 공고는 identity 전용 `core.auction_attempt` 행으로 먼저 만든다.
그 행은 관측된 외부 식별자일 뿐이고 revision이 없으므로 회차로 발표되지 않는다(ADR 0033).

목록에 없는 하한율·품목 라벨·지역 코드·기관 이름은 적재 뒤 같은 build 안에서 core를 한 번 조인해
채운다. 오늘 화면이 요청마다 core를 되짚으면 목록 경로가 원본 점 조회를 하게 되고, 그 조인 결과가
build마다 봉인되지 않으면 같은 build를 두 번 읽은 화면이 서로 다른 값을 본다(EAT-39 판정 A·B·C).
"""

from __future__ import annotations

from collections.abc import Callable
from decimal import Decimal
from typing import Any

from eatbid.core.projection_models import instant_datetime, money_decimal
from eatbid.mart.models import MartBuildPlan
from eatbid.mart.region_axis import REGION_TRANSLATION_CTE
from eatbid.source.eat.bid_list import parse_bid_list_page
from eatbid.source.eat.code_schemes import ORGANIZATION
from eatbid.storage.object_store import RawObjectStore

LIST_ENDPOINT = "bid-list"

_LIST_OBSERVATIONS_SQL = """
select observation.observation_id, observation.fetched_at, blob.object_key
  from ingest.source_release_observation as member
  join ingest.raw_observation as observation
    on observation.observation_id = member.observation_id
  join ingest.raw_blob as blob on blob.content_sha256 = observation.content_sha256
 where member.source_release_id = %(source_release_id)s
   and observation.source = 'eat'
   and observation.endpoint = %(endpoint)s
 order by observation.observation_id
"""

_ENSURE_ATTEMPT_SQL = """
insert into core.auction_attempt (source_system, external_bid_id)
values ('eat', %(external_bid_id)s)
on conflict on constraint auction_attempt_source_external_bid_key do nothing
"""

_ATTEMPT_ID_SQL = """
select auction_attempt_id from core.auction_attempt
 where source_system = 'eat' and external_bid_id = %(external_bid_id)s
"""

# 조직은 관측된 코드로만 찾는다. 목록이 준 이름으로 조직을 만들지 않는다 — 이름은 정체성이 아니고
# 조직 생성은 발행 경로의 책임이다(AGENTS 2).
_ORGANIZATION_ID_SQL = """
select identifier.organization_id
  from core.organization_identifier as identifier
  join core.code_value as value on value.code_value_id = identifier.code_value_id
  join core.code_scheme as scheme on scheme.code_scheme_id = value.code_scheme_id
 where scheme.namespace = %(namespace)s and value.code = %(code)s
"""

# 상태 라벨은 목록이 준 문자열 그대로 싣는다. 코드로 승격시키지 않는 이유는 `item_label`과 같다 —
# 이 어휘의 code scheme이 아직 없고, 없는 체계를 여기서 만들면 그 정의를 mart가 소유하게 된다.
_INSERT_SNAPSHOT_SQL = """
insert into mart.open_auction_snapshot (
  build_id, auction_attempt_id, observed_at, observation_id, organization_id,
  bid_count, source_last_changed_at, closes_at, opens_at, announced_at,
  base_amount, currency, item_code_value_id, item_label,
  source_status_code_value_id, source_status_label
) values (
  %(build_id)s, %(auction_attempt_id)s, %(observed_at)s, %(observation_id)s,
  %(organization_id)s, %(bid_count)s, %(source_last_changed_at)s, %(closes_at)s,
  null, null, %(base_amount)s, %(currency)s, null, null,
  null, %(source_status_label)s
)
on conflict on constraint open_auction_snapshot_observation_grain_key do nothing
"""

# 한 attempt의 "최신 revision"은 `auction_revision_id` 최대값이다. 관측 시각으로 고르지 않는 이유는
# 같은 raw의 replay가 시각을 되돌릴 수 있기 때문이고, revision id는 identity라 append 순서로
# 단조롭다 — `org_round_summary`가 쓰는 규칙과 같다.
#
# 상세가 없는 공고는 아무 열도 채우지 않는다. `terms_revision_id`가 비면 나머지 파생 열도 비어야
# 한다는 것은 표의 check가 강제한다.
_FILL_TERMS_SQL = "with " + REGION_TRANSLATION_CTE.strip() + """
update mart.open_auction_snapshot as snapshot
   set terms_revision_id = latest.auction_revision_id,
       floor_rate = latest.floor_rate,
       item_label = latest.item_label,
       region_sido_code_value_id = latest.sido_code_value_id,
       region_sigungu_code_value_id = latest.sigungu_code_value_id
  from (
    select distinct on (revision.auction_attempt_id)
           revision.auction_attempt_id,
           revision.auction_revision_id,
           revision.floor_rate,
           -- 품목 code scheme이 아직 없다. 관측 라벨을 코드로 승격시키지 않는다(EAT-44 판정 §4.2).
           nullif(btrim(coalesce(
             revision.source_payload #>> '{classification,sourceCategoryLabel}', ''
           )), '') as item_label,
           -- 선언한 체계로 번역되지 않는 지역은 null로 남는다. 코드가 있는 척하면 화면이 다른
           -- 체계의 구역을 이 build의 구역으로 읽는다(ADR 0035 결정 7).
           province_axis.region_code_value_id as sido_code_value_id,
           district_axis.region_code_value_id as sigungu_code_value_id
      from core.auction_revision as revision
      left join core.auction_revision_code_value as sido
        on sido.auction_revision_id = revision.auction_revision_id
       and sido.role = 'location_sido'
      left join core.auction_revision_code_value as sigungu
        on sigungu.auction_revision_id = revision.auction_revision_id
       and sigungu.role = 'location_sigungu'
      left join region_translation as province_axis
        on province_axis.source_code_value_id = sido.code_value_id
      left join region_translation as district_axis
        on district_axis.source_code_value_id = sigungu.code_value_id
     where revision.auction_attempt_id in (
             select auction_attempt_id from mart.open_auction_snapshot
              where build_id = %(build_id)s
           )
     -- 한 revision에 같은 role의 코드가 둘 이상 관측되면 어느 것을 실었는지가 실행마다 달라진다.
     order by revision.auction_attempt_id, revision.auction_revision_id desc,
              sido.code_value_id, sigungu.code_value_id
  ) as latest
 where snapshot.build_id = %(build_id)s
   and snapshot.auction_attempt_id = latest.auction_attempt_id
"""

# 기관 이름은 이 공고의 revision이 아니라 조직 코드에 매달린 관측이다. 그래서 상세가 아직 없는
# 공고도 그 조직의 다른 관측에서 이름을 얻을 수 있고, `terms_revision_id` 계보에는 들어가지 않는다.
# `organization.canonical_name`이 아니라 관측 라벨을 싣는 이유는 이름이 정체성이 아니기 때문이다
# (AGENTS 2, EAT-39 판정 G).
_FILL_ORGANIZATION_LABEL_SQL = """
update mart.open_auction_snapshot as snapshot
   set organization_label = (
         select observation.label
           from core.organization_identifier as identifier
           join core.code_label_observation as observation
             on observation.code_value_id = identifier.code_value_id
          where identifier.organization_id = snapshot.organization_id
          order by observation.observed_at desc,
                   observation.code_label_observation_id desc
          limit 1
       )
 where snapshot.build_id = %(build_id)s
   and snapshot.organization_id is not null
"""


def open_auction_snapshot_filler(
    store: RawObjectStore,
) -> Callable[..., int]:
    """빌더가 R2를 필요로 하므로 store를 닫아 `MartBuilder` 모양으로 돌려준다."""

    def fill(connection: Any, *, plan: MartBuildPlan, build_id: int) -> int:
        return fill_open_auction_snapshot(
            connection, plan=plan, build_id=build_id, store=store
        )

    return fill


def fill_open_auction_snapshot(
    connection: Any, *, plan: MartBuildPlan, build_id: int, store: RawObjectStore
) -> int:
    """release의 목록 관측을 전부 다시 읽어 이 build에 스냅샷을 적재한다."""
    inserted = 0
    with connection.cursor() as cursor:
        cursor.execute(
            _LIST_OBSERVATIONS_SQL,
            {
                "source_release_id": plan.source_release_id,
                "endpoint": LIST_ENDPOINT,
            },
        )
        observations = cursor.fetchall()

    for observation_id, fetched_at, object_key in observations:
        page = parse_bid_list_page(
            store.read(object_key), parser_version=plan.parser_version
        )
        with connection.cursor() as cursor:
            for row in page.rows:
                cursor.execute(
                    _ENSURE_ATTEMPT_SQL, {"external_bid_id": row.external_bid_id}
                )
                cursor.execute(
                    _ATTEMPT_ID_SQL, {"external_bid_id": row.external_bid_id}
                )
                attempt = cursor.fetchone()
                if attempt is None:
                    continue
                organization_id = _organization_id(
                    cursor,
                    code=(
                        row.buyer_organization_code.root
                        if row.buyer_organization_code is not None
                        else None
                    ),
                )
                base_amount: Decimal | None = money_decimal(row.base_amount)
                cursor.execute(
                    _INSERT_SNAPSHOT_SQL,
                    {
                        "build_id": build_id,
                        "auction_attempt_id": int(attempt[0]),
                        "observed_at": fetched_at,
                        "observation_id": int(observation_id),
                        "organization_id": organization_id,
                        "bid_count": row.competitor_count,
                        "source_last_changed_at": instant_datetime(row.last_changed_at),
                        "closes_at": instant_datetime(row.deadline_at),
                        "base_amount": base_amount,
                        "currency": None if base_amount is None else "KRW",
                        "source_status_label": row.status_name,
                    },
                )
                inserted += cursor.rowcount

    _fill_terms(connection, build_id=build_id, region_scheme=plan.region_scheme)
    return inserted


def _fill_terms(connection: Any, *, build_id: int, region_scheme: str | None) -> None:
    """이 build의 스냅샷 행에 최신 상세 해석과 기관 관측 이름을 덧입힌다.

    행 수를 바꾸지 않으므로 `verify_build`의 표본 검증과 어긋나지 않는다. 같은 build에 다시 돌려도
    같은 입력에서 같은 값을 다시 쓰기 때문에 재개한 빌드가 화면 값을 흔들지 않는다.
    """
    with connection.cursor() as cursor:
        cursor.execute(
            _FILL_TERMS_SQL,
            {"build_id": build_id, "region_scheme": region_scheme},
        )
        cursor.execute(_FILL_ORGANIZATION_LABEL_SQL, {"build_id": build_id})


def _organization_id(cursor: Any, *, code: str | None) -> int | None:
    if code is None:
        return None
    cursor.execute(
        _ORGANIZATION_ID_SQL, {"namespace": ORGANIZATION.namespace, "code": code}
    )
    row = cursor.fetchone()
    return None if row is None else int(row[0])
