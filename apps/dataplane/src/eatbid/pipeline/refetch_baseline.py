"""모듈 책임: 마지막으로 봉인된 정기 수집 release의 목록 관측을 R2에서 다시 읽어 재호출 기준으로 만든다."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Protocol

from eatbid.pipeline.refetch_policy import ListSignal, RefetchBaseline
from eatbid.source.eat.bid_list import parse_bid_list_page
from eatbid.storage.object_store import RawObjectStore

LIST_ENDPOINT = "bid-list"
# 기준이 될 수 있는 모드다. backfill은 과거 창이라 오늘 열린 공고를 담고 있다고 볼 수 없다.
BASELINE_RUN_MODES: tuple[str, ...] = ("poll-open", "daily-reconcile")

# 가장 최근에 관측된(as_of) 봉인 release 하나다. sealed_at이 아니라 as_of로 고르는 이유는 기준의
# 의미가 "언제 봉인했나"가 아니라 "언제 본 목록인가"이기 때문이다. 같은 as_of면 늦게 봉인된 쪽이다.
_LATEST_SEALED_RELEASE_SQL = """
select release.source_release_id
  from ingest.source_release as release
 where release.source = 'eat'
   and release.status = 'sealed'
   and exists (
         select 1
           from ingest.source_release_run as member
           join ingest.run as run on run.run_id = member.run_id
          where member.source_release_id = release.source_release_id
            and run.mode = any(%(modes)s)
       )
 order by release.as_of desc, release.sealed_at desc
 limit 1
"""

_LIST_OBSERVATIONS_SQL = """
select observation.fetched_at, blob.object_key
  from ingest.source_release_observation as member
  join ingest.raw_observation as observation
    on observation.observation_id = member.observation_id
  join ingest.raw_blob as blob on blob.content_sha256 = observation.content_sha256
 where member.source_release_id = %(source_release_id)s
   and observation.source = 'eat'
   and observation.endpoint = %(endpoint)s
 order by observation.observation_id
"""


class RefetchBaselineReader(Protocol):
    def load(self, *, parser_version: str) -> RefetchBaseline | None: ...


class PsycopgRefetchBaselineReader:
    """왜 원본 페이지를 다시 읽나. 목록 행은 정규화되지 않고 R2에만 남으므로(ADR 0034 §입력) 기준도
    같은 검토된 파서로 같은 원본에서 만든다. 파생물인 mart 스냅샷을 수집 판단의 입력으로 삼으면
    mart 재빌드가 수집 결과를 바꾼다."""

    def __init__(self, connection: Any, store: RawObjectStore) -> None:
        self._connection = connection
        self._store = store

    def load(self, *, parser_version: str) -> RefetchBaseline | None:
        # 읽기도 transaction 블록 안에서 한다. 밖에서 열린 암묵 transaction은 뒤따르는 발견 기록을
        # savepoint로 감싸 버려 프로세스 종료 때 통째로 되돌아간다.
        with self._connection.transaction(), self._connection.cursor() as cursor:
            cursor.execute(
                _LATEST_SEALED_RELEASE_SQL, {"modes": list(BASELINE_RUN_MODES)}
            )
            release = cursor.fetchone()
            if release is None:
                return None
            source_release_id = release[0]
            cursor.execute(
                _LIST_OBSERVATIONS_SQL,
                {"source_release_id": source_release_id, "endpoint": LIST_ENDPOINT},
            )
            observations = cursor.fetchall()

        signals: dict[str, ListSignal] = {}
        observed_at: datetime | None = None
        for fetched_at, object_key in observations:
            page = parse_bid_list_page(
                self._store.read(object_key), parser_version=parser_version
            )
            for row in page.rows:
                signals[row.external_bid_id] = ListSignal.from_row(row)
            observed_at = (
                fetched_at if observed_at is None else max(observed_at, fetched_at)
            )
        if observed_at is None:
            return None
        return RefetchBaseline(
            source_release_id=source_release_id,
            observed_at=observed_at,
            signals=signals,
        )
