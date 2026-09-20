"""모듈 책임: DB·R2·eaT adapter 수명주기를 소유하고 실제 pipeline application을 조립한다."""

from __future__ import annotations

import argparse
import json
from collections.abc import Mapping
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from functools import partial
from pathlib import Path
from types import TracebackType
from typing import Any, Self

import httpx
import psycopg
from psycopg.rows import dict_row

from eatbid.cache_revalidation import (
    WebCacheTarget,
    all_auctions_scope,
    mart_scope,
    revalidate_web_cache,
)
from eatbid.config import ApplicationSettings
from eatbid.core.postgres_repository import PsycopgCanonicalProjectionRepository
from eatbid.failures.errors import PublicationFailedError
from eatbid.failures.report import ApplicationConfigurationError
from eatbid.ingest.models import CaptureRequest
from eatbid.ingest.postgres_hold_repository import PsycopgSourceHoldRepository
from eatbid.ingest.postgres_normalization_repository import (
    PsycopgNormalizationRepository,
)
from eatbid.ingest.postgres_publication_repository import PsycopgPublicationRepository
from eatbid.ingest.postgres_release_repository import PsycopgSourceReleaseRepository
from eatbid.ingest.postgres_replay_repository import PsycopgReplayRunRepository
from eatbid.ingest.postgres_repository import PsycopgObservationRepository
from eatbid.ingest.postgres_run_closure import (
    close_projection_run,
    # 같은 이름의 메서드가 아래에 있다. Python은 method 안에서 class namespace를 건너뛰므로 그냥 써도
    # 맞게 풀리지만, 읽는 사람이 재귀로 오해할 자리라 별칭을 준다.
    close_stalled_run as close_stalled_run_in,
)
from eatbid.mart.build_marts import (
    build_marts,
    publication_record_types,
    resolve_marts,
)
from eatbid.mart.models import MartBuildPlan, MartName
from eatbid.mart.open_auction_snapshot import open_auction_snapshot_filler
from eatbid.mart.org_round_summary import fill_org_round_summary
from eatbid.mart.postgres_repository import PsycopgMartBuildRepository
from eatbid.mart.reaper import reap_expired_builds
from eatbid.mart.win_rate_distribution import fill_win_rate_distribution
from eatbid.monitoring.backup import (
    BackupExpectation,
    BackupObject,
    evaluate_backups,
)
from eatbid.monitoring.cluster import evaluate_cluster
from eatbid.monitoring.github import WorkflowExpectation, evaluate_workflows
from eatbid.monitoring.heartbeat import beat
from eatbid.monitoring.ledger import PostgresViolationLedger
from eatbid.monitoring.notify import send_telegram
from eatbid.monitoring.round import record_round
from eatbid.monitoring.runner import (
    MonitoringResult,
    ViolationProbe,
    run_expectation_check,
)
from eatbid.monitoring.state import decode_state
from eatbid.monitoring.store import R2BackupLister, R2StateStore
from eatbid.pipeline.advance import CompletedWindow, next_window
from eatbid.pipeline.capture import SourceThrottledError, capture
from eatbid.pipeline.code_vocabulary import (
    CodeVocabularyCapturePlan,
    CodeVocabularyServices,
    capture_code_vocabulary,
    project_code_vocabulary_observation,
)
from eatbid.pipeline.collection_window import SEOUL_TIME, resolve_collection_window
from eatbid.pipeline.contract_scan import ScanCandidate, scan_candidates
from eatbid.pipeline.discover import DiscoveryPlan, discover_release
from eatbid.pipeline.discovery_persistence import RawFirstDiscoveryPersistence
from eatbid.pipeline.normalize import normalize_observation
from eatbid.pipeline.project import project_publication
from eatbid.pipeline.reference import (
    ReferenceCapturePlan,
    ReferenceServices,
    capture_reference,
    project_reference,
)
from eatbid.pipeline.refetch_baseline import PsycopgRefetchBaselineReader
from eatbid.pipeline.replay import ReplayServices, replay_observations
from eatbid.pipeline.replay_target import FailedPublication, select_replay_target
from eatbid.pipeline.source_hold import (
    EAT_SOURCE,
    SCHEDULED_SOURCE_MODES,
    SourceHeldError,
)
from eatbid.pipeline.validate import validate_run
from eatbid.source.eat.http_client import EatHttpClient
from eatbid.source.reference.mois_client import build_reference_client
from eatbid.source.retry import TransientRetryPolicy
from eatbid.storage.r2_store import R2RawObjectStore, R2Settings

# 발행에 이르지 못한 상세 관측. 정규화된 적이 없거나 격리됐거나 정규화됐지만 revision이 없는 것 전부다. 창 범위는
# 목록 요청 파라미터에서만 파생된다(backfill_coverage와 같은 자리). 관측마다 raw 객체 하나라 같은 공고가 여러 창에
# 있으면 여러 번 보이며 그것이 맞다 — 보는 것은 공고가 아니라 raw다.
_SCAN_CANDIDATES_SQL = """
    select o.observation_id, b.object_key, o.content_sha256, u.request_params ->> 'ELCTRN_BID_ID'
      from ingest.raw_observation o
      join ingest.request_unit u on u.request_unit_id = o.request_unit_id
      join ingest.raw_blob b on b.content_sha256 = o.content_sha256
     where o.endpoint = 'bid-detail'
       and u.request_params ? 'ELCTRN_BID_ID'
       and not exists (
             select 1
               from ingest.normalized_record nr
               join core.auction_revision ar on ar.normalized_record_id = nr.normalized_record_id
              where nr.observation_id = o.observation_id
           )
       {window_filter}
     order by o.observation_id
     limit %(limit)s
"""
_SCAN_WINDOW_FILTER = """
       and exists (
             select 1
               from ingest.source_release_observation so
               join ingest.source_release_run sr on sr.source_release_id = so.source_release_id
               join ingest.request_unit lu on lu.run_id = sr.run_id and lu.endpoint = 'bid-list'
              where so.observation_id = o.observation_id
                and lu.request_params ->> 'P_BID_BGNG_DT' >= %(window_start)s
                and lu.request_params ->> 'P_BID_END_DT' <= %(window_end)s
           )
"""


def _log_tolerated(observation_id: int, reason: str) -> None:
    """계약 밖이라 모름으로 내린 칸을 실행 로그에 남긴다(ADR 0056 결정 3).

    machine result가 아니라 로그인 이유는 정규화가 CLI 경계로 값을 돌려주지 않기 때문이다. 이 줄은
    계약이 아니라 기록이며, Argo가 파드 로그를 R2와 OpenObserve로 보내므로 회차별로 다시 볼 수 있다.
    """
    print(
        json.dumps(
            {
                "event": "tolerated-out-of-contract-field",
                "observation_id": observation_id,
                "reason": reason,
            },
            sort_keys=True,
            separators=(",", ":"),
        )
    )


# 발행이 실패한 백필 창의 후보다. 창과 release를 잇는 방법은 `ingest.backfill_coverage` 뷰와 같다 —
# 목록 요청의 날짜 파라미터가 그 release가 어느 창인지를 말하는 유일한 사실이다. 정의를 둘로 만들지
# 않으려면 같은 근거를 써야 한다(EAT-274).
_REPLAY_CANDIDATES_SQL = """
with window_release as (
    select distinct u.request_params ->> 'P_BID_BGNG_DT' as window_start,
           sr.source_release_id
      from ingest.request_unit u
      join ingest.source_release_run sr on sr.run_id = u.run_id
     where u.endpoint = 'bid-list'
       and u.request_params ? 'P_BID_BGNG_DT'
)
select w.source_release_id, p.publication_id, r.build_sha, w.window_start
  from window_release w
  join ingest.source_release_run sr on sr.source_release_id = w.source_release_id
  join ingest.publication p on p.run_id = sr.run_id and p.status = 'failed'
  join ingest.run r on r.run_id = p.run_id
  join ingest.source_release rel on rel.source_release_id = w.source_release_id
 where rel.status = 'sealed'
   and not exists (
       select 1 from ingest.source_release_run sr2
       join ingest.publication p2 on p2.run_id = sr2.run_id and p2.status = 'published'
        where sr2.source_release_id = w.source_release_id
   )
 order by w.window_start desc
"""


class Application:
    """왜: 정상·예외 경로 모두 같은 concrete resource owner가 정확히 한 번 닫는다."""

    def __init__(
        self,
        *,
        connection: Any,
        http_client: Any,
        raw_store: Any = None,
        ingest_repository: Any = None,
        release_repository: Any = None,
        normalization_repository: Any = None,
        publication_repository: Any = None,
        replay_repository: Any = None,
        projection_repository: Any = None,
        mart_repository: Any = None,
        reference_http_client: Any = None,
        notify_cache: Any = None,
        monitoring: Any = None,
        hold_repository: Any = None,
        page_budget: int = 1,
    ) -> None:
        # 소스 차단 보류(ADR 0055). 정시 실행은 소스를 부르기 전에 이것을 읽고, capture는 차단 응답을 보면
        # 여기에 적는다. 없으면(테스트 조립) 보류를 모르는 채 돈다.
        self._holds = hold_repository
        self._connection = connection
        self._http = http_client
        self._store = raw_store
        self._ingest = ingest_repository
        self._release = release_repository
        self._normalization = normalization_repository
        self._publication = publication_repository
        self._replay = replay_repository
        self._projection = projection_repository
        self._mart = mart_repository
        # 정부 파일 다운로드는 eaT client의 재시도·헤더 정책을 쓰지 않는다. 소스가 다르면 실패
        # 모양도 다르고, 한쪽 정책을 다른 쪽에 물려 두면 어느 소스의 규칙인지 알 수 없어진다.
        self._reference_http = reference_http_client
        # 무효화 알림은 조립 시점에 주입한다. 설정이 없으면 None이고 파이프라인은 그 사실을 모른 채
        # 그대로 돈다 — 캐시 신선도는 발행의 성공 조건이 아니다(ADR 0036-3).
        self._notify_cache = notify_cache
        # 감시는 수집 DAG의 일부가 아니라 운영자 entrypoint다. 조립 시점에 없으면 None이고, 그때는
        # 명령이 실패한다. 없는 채로 성공하면 알림이 안 가는 상태가 정상으로 보인다.
        self._monitoring = monitoring
        self._page_budget = page_budget
        self._closed = False

    @classmethod
    def for_test(cls, *, connection: Any, http_client: Any) -> Application:
        return cls(connection=connection, http_client=http_client)

    def discover(self, args: argparse.Namespace) -> Any:
        # 정시 수집은 열린 보류가 있으면 소스를 부르기 전에 끝난다. run도 release도 만들지 않는다. 실패로
        # 남는 것이 의도다 — 오늘의 공고가 화면에 없는 것은 사람이 알아야 하고, 그 실패는 소스 호출 0회다
        # (ADR 0055 결정 3).
        if args.mode in SCHEDULED_SOURCE_MODES and self._holds is not None:
            hold = self._holds.open_hold(EAT_SOURCE, now=datetime.now(UTC))
            if hold is not None:
                raise SourceHeldError(hold)
        persistence = RawFirstDiscoveryPersistence(
            ingest_repository=self._ingest,
            release_repository=self._release,
            raw_store=self._store,
            baseline_reader=PsycopgRefetchBaselineReader(self._connection, self._store),
        )
        window = resolve_collection_window(
            args.mode,
            as_of=args.as_of,
            start_date=args.start_date,
            end_date=args.end_date,
        )
        return discover_release(
            DiscoveryPlan(
                source_release_id=args.source_release_id,
                run_id=args.run_id,
                detail_run_id=args.detail_run_id,
                mode=args.mode,
                release_name=args.release_name,
                workflow_name=args.workflow_name,
                as_of=args.as_of,
                build_sha=args.build_sha,
                parser_version=args.parser_version,
                started_at=args.started_at,
                completed_at=args.completed_at,
                start_date=window.start_date,
                end_date=window.end_date,
                progress_status_code=args.progress_status_code,
                region_code=args.region_code,
                page_size=args.page_size,
                page_budget=self._page_budget,
            ),
            persistence,
            self._http,
        )

    def capture(self, args: argparse.Namespace) -> Any:
        planned = self._release.load_preplanned_detail_request(
            args.source_release_id, args.run_id, args.external_bid_id
        )
        try:
            observation = capture(
                CaptureRequest(
                    request_unit_id=planned.request_unit_id,
                    run_id=planned.run_id,
                    source=planned.source,
                    endpoint=planned.endpoint,
                    params=planned.params,
                ),
                self._store,
                self._ingest,
                self._http,
            )
        except SourceThrottledError as error:
            # 차단 응답을 본 자리에서 보류를 적는다. 다음 정시 실행이 이것을 읽어 소스를 부르지 않는다
            # (ADR 0055 결정 2). 보류 때문에 안 부른 경우(SourceHeldError)는 새 보류가 아니다.
            if self._holds is not None and not isinstance(error, SourceHeldError):
                self._holds.record_throttle(
                    source=planned.source,
                    run_id=planned.run_id,
                    detail=f"HTTP {error.status_code} on {planned.endpoint}",
                    now=datetime.now(UTC),
                )
            raise
        self._release.ensure_captured_observation(
            args.source_release_id, args.run_id, observation.observation_id
        )
        return observation

    def normalize(self, args: argparse.Namespace) -> None:
        self._release.require_processing_observation(
            args.source_release_id, args.run_id, args.observation_id
        )
        normalize_observation(
            processing_run_id=args.run_id,
            observation_id=args.observation_id,
            parser_version=args.parser_version,
            normalized_at=args.normalized_at,
            store=self._store,
            repository=self._normalization,
            on_tolerated=_log_tolerated,
        )

    def validate(self, args: argparse.Namespace) -> Any:
        # release 봉인이 먼저다. 격리가 있어도 관측 집합은 완결됐고(ADR 0025), 발행 가능 여부는 그
        # 다음 완결 gate가 따로 판정한다. 그래야 실패한 회차도 replay 입력이 되는 봉인된 release를 남긴다.
        self._release.reconcile_and_seal(
            args.source_release_id, args.run_id, sealed_at=args.validated_at
        )
        validation = validate_run(
            run_id=args.run_id,
            publication_id=args.publication_id,
            validated_at=args.validated_at,
            repository=self._publication,
        )
        # publication을 실패로 기록한 뒤 0으로 끝나면 DAG가 project로 이어져 엉뚱한 자리에서 설정
        # 오류로 죽는다. ledger에 남긴 category가 곧 이 프로세스의 exit code다(EAT-122).
        if validation.status == "failed":
            if validation.failure_category is None:
                raise RuntimeError("failed publication has no failure category")
            raise PublicationFailedError(
                validation.failure_category, publication_id=args.publication_id
            )
        return validation

    def next_backfill_window(self, args: argparse.Namespace) -> Any:
        """다음에 채울 창 하나를 고른다. 아무것도 바꾸지 않는 읽기다.

        판단의 재료는 `ingest.backfill_coverage` 하나다. 그 view가 "이 창은 끝났다"의 정의를 소유하고
        전진 판단과 대시보드가 같은 답을 본다(ADR 0052 결정 2). 여기서 SQL을 따로 적으면 정의가
        둘이 된다.
        """
        # 열린 보류가 있으면 고를 창이 없다. 전진은 조용히 기다린다 — 백필은 하루 늦어도 되는 일이고, 소스를
        # 부르지 않는 것이 목적이다(ADR 0055 결정 3). 보류 자체는 기대가 든다.
        if (
            self._holds is not None
            and self._holds.open_hold(EAT_SOURCE, now=datetime.now(UTC)) is not None
        ):
            return None
        with self._connection.transaction(), self._connection.cursor() as cursor:
            cursor.execute(
                "select window_start, window_end, is_complete, failed_publications"
                " from ingest.backfill_coverage"
            )
            coverage = tuple(
                CompletedWindow(
                    start_date=str(row[0]),
                    end_date=str(row[1]),
                    is_complete=bool(row[2]),
                    failed_publications=int(row[3]),
                )
                for row in cursor.fetchall()
            )
        return next_window(
            as_of=args.as_of.astimezone(SEOUL_TIME).date(),
            floor=args.floor_date,
            coverage=coverage,
        )

    def reap_marts(self, args: argparse.Namespace) -> Any:
        """예약 entrypoint다. `retain_until`이 지난 superseded build의 mart 행을 회수한다(EAT-254).

        어떤 run에도 매이지 않고 build 원장 행은 건드리지 않는다. 활성 build와 mutex를 다투지 않는 이유는
        superseded가 종착 상태이고 행 삭제는 표의 trigger가 build 상태로 다시 거르기 때문이다(ADR 0034).
        """
        return reap_expired_builds(self._connection, as_of=args.as_of)

    def next_replay_target(self, args: argparse.Namespace) -> Any:
        """다시 시도할 가치가 있는 실패 창 하나를 고른다. 아무것도 바꾸지 않는 읽기다(EAT-274).

        이미 발행에 성공한 release는 후보에서 뺀다 — 한 창이 여러 번 실패한 뒤 성공했다면 그 창은
        닫힌 것이고, 실패 기록은 진단용으로 남아 있을 뿐이다.
        """
        # 읽기도 transaction 블록 안에서 한다. 블록 없이 커서만 쓰면 psycopg가 연 암묵 transaction이
        # 닫히지 않은 채 남고, close()의 가드가 그것을 "저장 안 된 채 끝났다"로 보고 실패시킨다
        # (EAT-273). 이 명령은 아무것도 쓰지 않으므로 뒤이어 commit해 줄 사람도 없다.
        with self._connection.transaction(), self._connection.cursor() as cursor:
            cursor.execute(_REPLAY_CANDIDATES_SQL)
            candidates = tuple(
                FailedPublication(
                    source_release_id=row[0],
                    publication_id=row[1],
                    build_sha=str(row[2]),
                    window_start=str(row[3]),
                )
                for row in cursor.fetchall()
            )
        return select_replay_target(
            candidates,
            build_sha=args.build_sha,
            run_id=args.run_id,
            as_of=args.as_of,
        )

    def check_expectations(self, args: argparse.Namespace) -> Any:
        # 운영자·스케줄 entrypoint다. 어떤 DAG에도 들지 않으며 수집 상태를 바꾸지 않고 읽기만 한다.
        if self._monitoring is None:
            raise RuntimeError(
                "감시 알림 설정이 없습니다. TELEGRAM_BOT_TOKEN·TELEGRAM_CHAT_ID를 주입하십시오."
            )
        return self._monitoring.run()

    def scan_contract(self, args: argparse.Namespace) -> Any:
        """운영자 entrypoint다. 발행되지 않은 상세 관측의 raw에 지금 파서를 돌려 격리 사유를 모은다. DB에 쓰지
        않고 R2는 읽기만 한다(EAT-251). 창 범위를 주면 그 창의 release에 속한 관측만 본다."""
        parameters: dict[str, Any] = {"limit": args.limit}
        window_filter = ""
        if args.window_start and args.window_end:
            window_filter = _SCAN_WINDOW_FILTER
            parameters.update(
                {"window_start": args.window_start, "window_end": args.window_end}
            )
        with self._connection.transaction(), self._connection.cursor() as cursor:
            cursor.execute(
                _SCAN_CANDIDATES_SQL.format(window_filter=window_filter), parameters
            )
            candidates = [
                ScanCandidate(
                    observation_id=int(row[0]),
                    object_key=str(row[1]),
                    content_sha256=str(row[2]),
                    external_bid_id=str(row[3]),
                )
                for row in cursor.fetchall()
            ]
        return scan_candidates(
            candidates,
            read_raw=self._store.read,
            parser_version=args.parser_version,
            now=datetime.now(UTC),
            on_progress=lambda report: print(
                f"scanned={report.scanned} ok={report.ok} quarantined={report.quarantined}",
                flush=True,
            ),
        )

    def close_stalled_run(self, args: argparse.Namespace) -> Any:
        """전진이 멎은 run을 운영자 판정으로 닫는다(EAT-234).

        `fail-release`와 나눈 이유는 닫는 대상이 다르기 때문이다. 그쪽은 `planned` release를 닫으면서
        딸린 run을 함께 닫는데, capture까지 성공해 release가 이미 봉인된 뒤 프로세스가 사라지면 그
        경로가 닿지 않는다. 그런 run은 어느 쪽으로도 닫히지 않아 `backfill-progress` 위반이 영원히
        열린 채 남는다.
        """
        with self._connection.transaction(), self._connection.cursor() as cursor:
            mode = close_stalled_run_in(
                cursor,
                run_id=args.run_id,
                outcome=args.outcome,
                ended_at=args.ended_at,
                failure_category=args.failure_category,
                stall_after=args.stall_after,
            )
        return {
            "run_id": str(args.run_id),
            "mode": mode,
            "outcome": args.outcome,
            "failure_category": args.failure_category,
        }

    def fail_release(self, args: argparse.Namespace) -> Any:
        # 운영자 판정이다. planned는 같은 run으로 이어 갈 수 있는 상태라 어떤 단계도 자동으로 여기 오지
        # 않으며, 포기를 정한 사람이 release와 열린 run을 같은 category로 닫는다(EAT-122).
        return self._release.fail_release(
            args.source_release_id,
            failure_category=args.failure_category,
            failed_at=args.failed_at,
        )

    def project(self, args: argparse.Namespace) -> None:
        self._release.require_publication_corpus(
            args.source_release_id, args.run_id, args.publication_id
        )
        project_publication(
            publication_id=args.publication_id,
            projector_version=args.build_sha,
            activated_at=args.activated_at,
            repository=self._projection,
        )
        # core가 새 사실을 공개한 뒤에만 부른다. 앞에서 부르면 화면이 옛 값을 다시 캐시한다.
        self._revalidate_web_cache(all_auctions_scope())

    def replay(self, args: argparse.Namespace) -> None:
        self._release.require_sealed(args.source_release_id)
        # 목록을 주지 않으면 그 release의 상세 관측 전부가 대상이다(EAT-274). 저장소가 읽으므로
        # workflow parameter 상한에 걸리지 않고 사람이 나눌 일도 없다.
        observation_ids = (
            tuple(args.observation_id)
            if args.observation_id
            else self._release.detail_observation_ids(args.source_release_id)
        )
        self._release.require_observation_members(
            args.source_release_id, observation_ids
        )
        replay_observations(
            run_id=args.run_id,
            publication_id=args.publication_id,
            observation_ids=observation_ids,
            build_sha=args.build_sha,
            parser_version=args.parser_version,
            started_at=args.started_at,
            normalized_at=args.normalized_at,
            validated_at=args.validated_at,
            activated_at=args.activated_at,
            services=ReplayServices(
                replay_repository=self._replay,
                normalization_repository=self._normalization,
                publication_repository=self._publication,
                projection_repository=self._projection,
                store=self._store,
            ),
        )

    def capture_reference(self, args: argparse.Namespace) -> Any:
        return capture_reference(
            ReferenceCapturePlan(
                run_id=args.run_id,
                source_release_id=args.source_release_id,
                source_id=args.source,
                dataset=args.dataset,
                release_name=args.release_name,
                build_sha=args.build_sha,
                parser_version=args.parser_version,
                as_of=args.as_of,
                started_at=args.started_at,
            ),
            ReferenceServices(
                http_client=self._reference_http,
                store=self._store,
                ingest_repository=self._ingest,
                release_repository=self._release,
            ),
        )

    def project_reference(self, args: argparse.Namespace) -> Any:
        self._release.require_sealed(args.source_release_id)
        self._release.require_observation_member(
            args.source_release_id, args.observation_id
        )
        with self._connection.transaction(), self._connection.cursor() as cursor:
            result = project_reference(
                cursor,
                store=self._store,
                source_id=args.source,
                dataset=args.dataset,
                source_release_id=args.source_release_id,
                observation_id=args.observation_id,
                source_version=args.release_name,
                projected_at=args.projected_at,
            )
            # 이 lane의 마지막 단계다. 여기서 닫지 않으면 run이 영원히 `running`으로 남는다(EAT-234).
            close_projection_run(
                cursor,
                run_id=args.run_id,
                ended_at=args.projected_at,
                published_count=1,
            )
            return result

    def capture_code_vocabulary(self, args: argparse.Namespace) -> Any:
        return capture_code_vocabulary(
            CodeVocabularyCapturePlan(
                run_id=args.run_id,
                source_release_id=args.source_release_id,
                release_name=args.release_name,
                build_sha=args.build_sha,
                parser_version=args.parser_version,
                as_of=args.as_of,
                started_at=args.started_at,
            ),
            CodeVocabularyServices(
                # 정부 파일용 client가 아니라 eaT client를 쓴다. 코드목록은 eaT의 검토된 헤더·warmup·
                # 재시도 정책 안에서 도는 같은 소스의 호출이다.
                http_client=self._http,
                store=self._store,
                ingest_repository=self._ingest,
                release_repository=self._release,
            ),
        )

    def project_code_vocabulary(self, args: argparse.Namespace) -> Any:
        self._release.require_sealed(args.source_release_id)
        self._release.require_observation_member(
            args.source_release_id, args.observation_id
        )
        with self._connection.transaction(), self._connection.cursor() as cursor:
            result = project_code_vocabulary_observation(
                cursor,
                store=self._store,
                source_release_id=args.source_release_id,
                observation_id=args.observation_id,
                parser_version=args.parser_version,
                projected_at=args.projected_at,
            )
            # 관측 하나가 곧 회차인 lane이라 발행 단계가 없다. 투영이 끝난 자리에서 run을 닫는다(EAT-234).
            close_projection_run(
                cursor,
                run_id=args.run_id,
                ended_at=args.projected_at,
                published_count=1,
            )
            return result

    def build_marts(self, args: argparse.Namespace) -> Any:
        record_types = publication_record_types(self._mart, args.publication_id)
        marts = resolve_marts(
            requested=args.mart,
            record_types=record_types,
            run_mode=self._mart.run_mode(args.run_id),
        )

        def plan_for(mart_name: MartName) -> MartBuildPlan:
            return MartBuildPlan(
                mart_name=mart_name,
                source_release_id=args.source_release_id,
                publication_id=args.publication_id,
                calc_version=args.calc_version,
                builder_version=args.build_sha,
                parser_version=args.parser_version,
                region_scheme=args.region_scheme,
                as_of=args.as_of,
                started_at=args.built_at,
                computed_at=args.built_at,
            )

        results = build_marts(marts=marts, plan_for=plan_for, repository=self._mart)
        # 활성 포인터가 이미 움직인 뒤다. 여기서 실패해도 전환을 되돌리지 않는다(ADR 0034·0036-3).
        self._revalidate_web_cache(mart_scope([result.mart_name for result in results]))
        return results

    def _revalidate_web_cache(self, scope: Any) -> None:
        if self._notify_cache is not None:
            self._notify_cache(scope)

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        failure = False
        try:
            self._http.close()
        except Exception:  # noqa: BLE001 - provider detail은 composition 밖에 노출하지 않는다.
            failure = True
        if self._reference_http is not None:
            try:
                self._reference_http.close()
            except Exception:  # noqa: BLE001 - provider detail은 숨긴다.
                failure = True
        # 저장되지 않은 채 끝나는 것을 여기서 막는다. psycopg는 열린 transaction을 조용히 되돌리고
        # 닫으므로, 확인하지 않으면 단계가 exit 0으로 "성공"을 보고하면서 행은 하나도 남지 않는다.
        # 2026-09-17에 정시 수집이 22시간 그렇게 멈췄고 어떤 단계도 실패로 보이지 않았다(EAT-264).
        # 실수의 종류와 무관하게 이 자리 하나가 모든 명령의 조용한 롤백을 시끄러운 실패로 바꾼다.
        uncommitted = False
        try:
            uncommitted = (
                self._connection.info.transaction_status
                is not psycopg.pq.TransactionStatus.IDLE
            )
        except Exception:  # noqa: BLE001 - 이미 끊긴 연결은 아래 close가 판정한다.
            uncommitted = False
        try:
            self._connection.close()
        except Exception:  # noqa: BLE001 - DSN/provider detail은 숨긴다.
            failure = True
        if uncommitted:
            raise RuntimeError(
                "database work was left uncommitted; the command reported success "
                "but nothing was stored"
            ) from None
        if failure:
            raise RuntimeError("application resources could not be closed") from None

    def __enter__(self) -> Self:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        try:
            self.close()
        except RuntimeError:
            if exc_value is None:
                raise


class _MonitoringRunner:
    """감시 한 회차에 필요한 것만 들고 있는 얇은 배선.

    왜 별도 객체인가: 감시는 수집 repository를 하나도 쓰지 않는다. Application에 질의·저장소·알림을
    따로 매달면 수집 조립과 감시 조립이 섞여 어느 쪽이 무엇을 쓰는지 흐려진다.
    """

    def __init__(
        self,
        *,
        connection: Any,
        state_store: Any,
        backup_lister: Any,
        config: ApplicationSettings,
    ) -> None:
        self._connection = connection
        self._state_store = state_store
        self._backup_lister = backup_lister
        self._config = config

    def _run_query(
        self, sql: str, parameters: Mapping[str, Any]
    ) -> list[dict[str, Any]]:
        # 읽기지만 transaction 블록 안에서 한다. 지금까지 이 경로가 안 죽은 것은 같은 회차의
        # _execute·_mutate가 뒤이어 commit해 close() 시점에 transaction이 이미 닫혀 있었기 때문이다.
        # 쓸 것이 하나도 없는 회차가 오면 EAT-273의 가드에 그대로 걸린다 — 우연에 기대지 않는다.
        with self._connection.transaction(), self._connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(sql, parameters)
            return list(cursor.fetchall())

    def _notify(self, text: str) -> None:
        token = self._config.telegram_bot_token
        chat_id = self._config.telegram_chat_id
        if token is None or chat_id is None:
            raise RuntimeError("감시 알림 대상이 없습니다.")
        send_telegram(token=token.get_secret_value(), chat_id=chat_id, text=text)

    def _fetch_workflow_runs(
        self, expectation: WorkflowExpectation
    ) -> list[Mapping[str, Any]]:
        """GitHub 공개 API에서 최근 회차만 읽는다. 저장소가 공개라 인증 헤더가 없다.

        `per_page`를 작게 두는 이유는 판정에 최신 회차와 그 앞의 끝난 회차 하나면 충분하기 때문이다.
        `exclude_pull_requests`는 PR 회차를 빼 원격 main의 판정에 다른 branch가 섞이지 않게 한다.
        """
        repository = self._config.github_repository
        parameters: dict[str, Any] = {"per_page": 5, "exclude_pull_requests": "true"}
        if expectation.branch is not None:
            parameters["branch"] = expectation.branch
        response = httpx.get(
            f"https://api.github.com/repos/{repository}"
            f"/actions/workflows/{expectation.workflow_file}/runs",
            params=parameters,
            headers={"Accept": "application/vnd.github+json"},
            timeout=20.0,
        )
        response.raise_for_status()
        payload = response.json()
        runs = payload.get("workflow_runs") if isinstance(payload, Mapping) else None
        return [run for run in runs or () if isinstance(run, Mapping)]

    def _list_cluster_resources(self, path: str) -> list[Mapping[str, Any]]:
        """클러스터 안에서 Kubernetes API를 읽는다.

        왜 kubernetes client 패키지를 쓰지 않는가: 필요한 것이 GET 둘뿐이라 의존성 하나를 더하는 값이
        없다. ServiceAccount token과 CA는 kubelet이 파드 안에 놓아 주며, 그 경로는 Kubernetes가
        정한 자리다.

        왜 token을 매번 읽는가: projected token은 만료 전에 파일이 갱신된다. 한 번 읽어 두면 오래 사는
        프로세스에서 만료된 token을 계속 보내게 된다 — 감시는 15분마다 새로 뜨지만 그 가정에 기대지 않는다.
        """
        root = Path("/var/run/secrets/kubernetes.io/serviceaccount")
        token = (root / "token").read_text(encoding="utf-8").strip()
        response = httpx.get(
            f"https://kubernetes.default.svc{path}",
            headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
            verify=str(root / "ca.crt"),
            timeout=20.0,
        )
        response.raise_for_status()
        payload = response.json()
        items = payload.get("items") if isinstance(payload, Mapping) else None
        return [item for item in items or () if isinstance(item, Mapping)]

    def _list_backup_objects(
        self, expectation: BackupExpectation
    ) -> list[BackupObject]:
        return self._backup_lister.list(expectation.prefix)

    def _probes(self) -> tuple[ViolationProbe, ...]:
        probes: list[ViolationProbe] = [
            lambda: evaluate_backups(self._list_backup_objects),
            lambda: evaluate_cluster(self._list_cluster_resources),
        ]
        if self._config.github_repository is not None:
            probes.append(lambda: evaluate_workflows(self._fetch_workflow_runs))
        return tuple(probes)

    def _execute(self, sql: str, parameters: Mapping[str, Any]) -> None:
        # 회차 지표 한 행. 연결은 autocommit이 아니므로 여기서 commit해야 행이 남는다 — 읽기 질의
        # (_run_query)는 commit이 필요 없어 그쪽에는 없다.
        with self._connection.cursor() as cursor:
            cursor.execute(sql, parameters)
        self._connection.commit()

    def _mutate(self, sql: str, parameters: Mapping[str, Any]) -> list[dict[str, Any]]:
        # 위반 표 쓰기. `returning`이 있으면 그 행을 돌려주고, 없으면 빈 목록이다. 문장마다 commit하는 이유는
        # 한 회차 안에서 insert한 id를 다음 문장이 바로 참조하고, 회차가 중간에 죽어도 그때까지의 기록은
        # 남아야 하기 때문이다 — 기록이 없는 것보다 반쪽 기록이 낫다(ADR 0054).
        with self._connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(sql, parameters)
            rows = list(cursor.fetchall()) if cursor.description else []
        self._connection.commit()
        return rows

    def _ledger(self) -> PostgresViolationLedger:
        environment = self._config.environment_name
        ledger = PostgresViolationLedger(
            query=self._run_query, mutate=self._mutate, environment=environment
        )
        # R2 문서 시절의 열린 위반을 표가 비어 있을 때 한 번만 옮긴다(ADR 0054 결정 3). 처음 본 시각만
        # 아는 값이고, 그것을 잃으면 "5일째"가 "방금"이 된다. 그 뒤로 R2 문서는 읽지도 쓰지도 않는다.
        if ledger.is_empty():
            inherited = decode_state(self._state_store.read())
            if inherited:
                ledger.import_open(inherited, now=datetime.now(UTC))
        return ledger

    def run(self) -> MonitoringResult:
        result = run_expectation_check(
            run_query=self._run_query,
            ledger=self._ledger(),
            notify=self._notify,
            environment=self._config.environment_name,
            probes=self._probes(),
            record_round=lambda metrics: record_round(self._execute, metrics),
        )
        # 회차가 끝까지 끝난 뒤에만 밖에 신호를 보낸다. 위에서 예외가 나면(텔레그램 전송 실패, 상태 문서
        # 기록 실패) 여기에 닿지 않고, 그러면 바깥이 신호 끊김으로 알린다 — 그것이 의도다.
        url = self._config.heartbeat_url
        outcome = beat(url.get_secret_value() if url is not None else None)
        return replace(result, heartbeat=outcome)


def _build_monitoring(
    config: ApplicationSettings, connection: Any
) -> _MonitoringRunner | None:
    if config.telegram_bot_token is None or config.telegram_chat_id is None:
        return None
    state_store = R2StateStore(
        endpoint_url=str(config.r2_endpoint_url),
        bucket=config.r2_bucket,
        access_key_id=config.r2_access_key_id.get_secret_value(),
        secret_access_key=config.r2_secret_access_key.get_secret_value(),
        key=f"monitoring/{config.environment_name}/expectation-state.json",
    )
    backup_lister = R2BackupLister(
        endpoint_url=str(config.r2_endpoint_url),
        bucket=config.r2_bucket,
        access_key_id=config.r2_access_key_id.get_secret_value(),
        secret_access_key=config.r2_secret_access_key.get_secret_value(),
    )
    return _MonitoringRunner(
        connection=connection,
        state_store=state_store,
        backup_lister=backup_lister,
        config=config,
    )


def build_application(config: ApplicationSettings) -> Application:
    dsn = config.database_url.get_secret_value()
    connection: Any = None
    http_client: Any = None
    reference_client: Any = None
    store: Any = None
    construction_failure: ApplicationConfigurationError | None = None
    try:
        connection = psycopg.connect(dsn)
        timeout = httpx.Timeout(
            connect=config.source_connect_timeout_seconds,
            read=config.source_read_timeout_seconds,
            write=config.source_write_timeout_seconds,
            pool=config.source_pool_timeout_seconds,
        )
        http_client = EatHttpClient(timeout=timeout, retry_policy=_retry_policy(config))
        reference_client = build_reference_client(timeout)
        store = R2RawObjectStore(
            R2Settings(
                endpoint_url=config.r2_endpoint_url,
                bucket=config.r2_bucket,
                access_key_id=config.r2_access_key_id,
                secret_access_key=config.r2_secret_access_key,
            )
        )
    except Exception as cause:  # noqa: BLE001 - provider 예외 객체는 여기서 닫고 이름만 옮긴다.
        construction_failure = ApplicationConfigurationError(cause)
        for resource in (http_client, reference_client, connection):
            if resource is not None:
                _close_ignoring_error(resource)
    if construction_failure is not None:
        construction_failure.__context__ = None
        raise construction_failure from None
    return Application(
        connection=connection,
        http_client=http_client,
        raw_store=store,
        monitoring=_build_monitoring(config, connection),
        ingest_repository=PsycopgObservationRepository(connection),
        release_repository=PsycopgSourceReleaseRepository(connection),
        hold_repository=PsycopgSourceHoldRepository(connection),
        normalization_repository=PsycopgNormalizationRepository(connection),
        publication_repository=PsycopgPublicationRepository(connection),
        replay_repository=PsycopgReplayRunRepository(connection),
        projection_repository=PsycopgCanonicalProjectionRepository(
            connection, lambda: psycopg.connect(dsn)
        ),
        mart_repository=PsycopgMartBuildRepository(
            connection,
            lambda: psycopg.connect(dsn),
            {
                "org_round_summary": fill_org_round_summary,
                "win_rate_distribution_monthly": fill_win_rate_distribution,
                "open_auction_snapshot": open_auction_snapshot_filler(store),
            },
        ),
        reference_http_client=reference_client,
        notify_cache=partial(
            revalidate_web_cache, target=_web_cache_target(config), client=httpx
        ),
        page_budget=config.source_page_budget,
    )


def _web_cache_target(config: ApplicationSettings) -> WebCacheTarget | None:
    """왜: 둘 중 하나만 있는 설정은 "무효화를 켜려다 만 상태"다. 반쪽 설정으로 401을 반복해서
    남기는 것보다 켜지 않은 것으로 보는 편이 운영에서 읽기 쉽다."""
    if config.web_internal_url is None or config.cache_revalidate_token is None:
        return None
    return WebCacheTarget(
        base_url=str(config.web_internal_url), token=config.cache_revalidate_token
    )


def _retry_policy(config: ApplicationSettings) -> TransientRetryPolicy:
    """왜: 초 단위 환경변수를 단위 있는 duration으로 바꾸는 자리는 이 조립 경계 하나뿐이다.
    아래 계층에는 숫자가 아니라 timedelta만 내려간다."""
    return TransientRetryPolicy(
        max_attempts=config.source_retry_max_attempts,
        initial_backoff=timedelta(seconds=config.source_retry_initial_backoff_seconds),
        backoff_multiplier=config.source_retry_backoff_multiplier,
        max_total_backoff=timedelta(
            seconds=config.source_retry_max_total_backoff_seconds
        ),
    )


def _close_ignoring_error(resource: Any) -> None:
    try:
        resource.close()
    except Exception:  # noqa: BLE001 - cleanup 상세를 provider 실패에 붙이지 않는다.
        return
