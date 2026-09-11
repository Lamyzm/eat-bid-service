"""모듈 책임: DB·R2·eaT adapter 수명주기를 소유하고 실제 pipeline application을 조립한다."""

from __future__ import annotations

import argparse
from collections.abc import Mapping
from datetime import timedelta
from functools import partial
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
from eatbid.ingest.postgres_normalization_repository import (
    PsycopgNormalizationRepository,
)
from eatbid.ingest.postgres_publication_repository import PsycopgPublicationRepository
from eatbid.ingest.postgres_release_repository import PsycopgSourceReleaseRepository
from eatbid.ingest.postgres_replay_repository import PsycopgReplayRunRepository
from eatbid.ingest.postgres_repository import PsycopgObservationRepository
from eatbid.mart.build_marts import (
    build_marts,
    publication_record_types,
    resolve_marts,
)
from eatbid.mart.models import MartBuildPlan, MartName
from eatbid.mart.open_auction_snapshot import open_auction_snapshot_filler
from eatbid.mart.org_round_summary import fill_org_round_summary
from eatbid.mart.postgres_repository import PsycopgMartBuildRepository
from eatbid.mart.win_rate_distribution import fill_win_rate_distribution
from eatbid.monitoring.notify import send_telegram
from eatbid.monitoring.runner import MonitoringResult, run_expectation_check
from eatbid.monitoring.store import R2StateStore
from eatbid.pipeline.capture import capture
from eatbid.pipeline.collection_window import resolve_collection_window
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
from eatbid.pipeline.validate import validate_run
from eatbid.source.eat.http_client import EatHttpClient
from eatbid.source.reference.mois_client import build_reference_client
from eatbid.source.retry import TransientRetryPolicy
from eatbid.storage.r2_store import R2RawObjectStore, R2Settings


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
        page_budget: int = 1,
    ) -> None:
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

    def check_expectations(self, args: argparse.Namespace) -> Any:
        # 운영자·스케줄 entrypoint다. 어떤 DAG에도 들지 않으며 수집 상태를 바꾸지 않고 읽기만 한다.
        if self._monitoring is None:
            raise RuntimeError(
                "감시 알림 설정이 없습니다. TELEGRAM_BOT_TOKEN·TELEGRAM_CHAT_ID를 주입하십시오."
            )
        return self._monitoring.run()

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
        self._release.require_observation_members(
            args.source_release_id, tuple(args.observation_id)
        )
        replay_observations(
            run_id=args.run_id,
            publication_id=args.publication_id,
            observation_ids=tuple(args.observation_id),
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
            return project_reference(
                cursor,
                store=self._store,
                source_id=args.source,
                dataset=args.dataset,
                source_release_id=args.source_release_id,
                observation_id=args.observation_id,
                source_version=args.release_name,
                projected_at=args.projected_at,
            )

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
        try:
            self._connection.close()
        except Exception:  # noqa: BLE001 - DSN/provider detail은 숨긴다.
            failure = True
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

    def __init__(self, *, connection: Any, state_store: Any, config: ApplicationSettings) -> None:
        self._connection = connection
        self._state_store = state_store
        self._config = config

    def _run_query(self, sql: str, parameters: Mapping[str, Any]) -> list[dict[str, Any]]:
        with self._connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(sql, parameters)
            return list(cursor.fetchall())

    def _notify(self, text: str) -> None:
        token = self._config.telegram_bot_token
        chat_id = self._config.telegram_chat_id
        if token is None or chat_id is None:
            raise RuntimeError("감시 알림 대상이 없습니다.")
        send_telegram(token=token.get_secret_value(), chat_id=chat_id, text=text)

    def run(self) -> MonitoringResult:
        return run_expectation_check(
            run_query=self._run_query,
            state_store=self._state_store,
            notify=self._notify,
            environment=self._config.environment_name,
        )


def _build_monitoring(config: ApplicationSettings, connection: Any) -> _MonitoringRunner | None:
    if config.telegram_bot_token is None or config.telegram_chat_id is None:
        return None
    state_store = R2StateStore(
        endpoint_url=str(config.r2_endpoint_url),
        bucket=config.r2_bucket,
        access_key_id=config.r2_access_key_id.get_secret_value(),
        secret_access_key=config.r2_secret_access_key.get_secret_value(),
        key=f"monitoring/{config.environment_name}/expectation-state.json",
    )
    return _MonitoringRunner(connection=connection, state_store=state_store, config=config)


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
        http_client = EatHttpClient(
            timeout=timeout, retry_policy=_retry_policy(config)
        )
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
