"""모듈 책임: 봉인된 release의 목록 관측을 R2에서 다시 읽어 열린 공고 스냅샷 mart를 만든다.

다른 두 mart와 달리 입력이 PostgreSQL에 없다. 목록 행은 normalized record가 되지 않고 원본 페이지만
R2에 남기 때문이다. 그래서 검토된 목록 파서를 그대로 다시 써서 스냅샷을 만든다 — 새 record type도
새 core 표도 만들지 않으며, replay가 하는 것과 같은 모양이다(ADR 0034 §입력).

목록에만 있고 아직 상세를 따지 않은 공고는 identity 전용 `core.auction_attempt` 행으로 먼저 만든다.
그 행은 관측된 외부 식별자일 뿐이고 revision이 없으므로 회차로 발표되지 않는다(ADR 0033).
"""

from __future__ import annotations

from collections.abc import Callable
from decimal import Decimal
from typing import Any

from eatbid.core.projection_models import instant_datetime, money_decimal
from eatbid.mart.models import MartBuildPlan
from eatbid.object_store import RawObjectStore
from eatbid.source.eat.bid_list import parse_bid_list_page
from eatbid.source.eat.code_schemes import ORGANIZATION

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

_INSERT_SNAPSHOT_SQL = """
insert into mart.open_auction_snapshot (
  build_id, auction_attempt_id, observed_at, observation_id, organization_id,
  bid_count, source_last_changed_at, closes_at, opens_at, announced_at,
  base_amount, currency, item_code_value_id, item_label, source_status_code_value_id
) values (
  %(build_id)s, %(auction_attempt_id)s, %(observed_at)s, %(observation_id)s,
  %(organization_id)s, %(bid_count)s, %(source_last_changed_at)s, %(closes_at)s,
  null, null, %(base_amount)s, %(currency)s, null, null, null
)
on conflict on constraint open_auction_snapshot_observation_grain_key do nothing
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
                    },
                )
                inserted += cursor.rowcount

    return inserted


def _organization_id(cursor: Any, *, code: str | None) -> int | None:
    if code is None:
        return None
    cursor.execute(
        _ORGANIZATION_ID_SQL, {"namespace": ORGANIZATION.namespace, "code": code}
    )
    row = cursor.fetchone()
    return None if row is None else int(row[0])
