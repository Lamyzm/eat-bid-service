"""모듈 책임: DB·R2·eaT adapter 수명주기를 소유하고 실제 pipeline application을 조립한다."""

from __future__ import annotations

import argparse
from types import TracebackType
from typing import Any, Self

import httpx
import psycopg

from eatbid.config import ApplicationSettings
from eatbid.core.postgres_repository import PsycopgCanonicalProjectionRepository
from eatbid.failure_report import ApplicationConfigurationError
from eatbid.ingest.models import CaptureRequest
from eatbid.ingest.postgres_normalization_repository import (
    PsycopgNormalizationRepository,
)
from eatbid.ingest.postgres_publication_repository import PsycopgPublicationRepository
from eatbid.ingest.postgres_release_repository import PsycopgSourceReleaseRepository
from eatbid.ingest.postgres_replay_repository import PsycopgReplayRunRepository
from eatbid.ingest.postgres_repository import PsycopgObservationRepository
from eatbid.pipeline.capture import capture
from eatbid.pipeline.collection_window import resolve_collection_window
from eatbid.pipeline.discover import DiscoveryPlan, discover_release
from eatbid.pipeline.discovery_persistence import RawFirstDiscoveryPersistence
from eatbid.pipeline.normalize import normalize_observation
from eatbid.pipeline.project import project_publication
from eatbid.pipeline.replay import ReplayServices, replay_observations
from eatbid.pipeline.validate import validate_run
from eatbid.r2_store import R2RawObjectStore, R2Settings
from eatbid.source.eat.http_client import EatHttpClient


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
        self._release.reconcile_and_seal(
            args.source_release_id, args.run_id, sealed_at=args.validated_at
        )
        return validate_run(
            run_id=args.run_id,
            publication_id=args.publication_id,
            validated_at=args.validated_at,
            repository=self._publication,
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

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        failure = False
        try:
            self._http.close()
        except Exception:  # noqa: BLE001 - provider detail은 composition 밖에 노출하지 않는다.
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


def build_application(config: ApplicationSettings) -> Application:
    dsn = config.database_url.get_secret_value()
    connection: Any = None
    http_client: Any = None
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
        http_client = EatHttpClient(timeout=timeout)
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
        for resource in (http_client, connection):
            if resource is not None:
                _close_ignoring_error(resource)
    if construction_failure is not None:
        construction_failure.__context__ = None
        raise construction_failure from None
    return Application(
        connection=connection,
        http_client=http_client,
        raw_store=store,
        ingest_repository=PsycopgObservationRepository(connection),
        release_repository=PsycopgSourceReleaseRepository(connection),
        normalization_repository=PsycopgNormalizationRepository(connection),
        publication_repository=PsycopgPublicationRepository(connection),
        replay_repository=PsycopgReplayRunRepository(connection),
        projection_repository=PsycopgCanonicalProjectionRepository(
            connection, lambda: psycopg.connect(dsn)
        ),
        page_budget=config.source_page_budget,
    )


def _close_ignoring_error(resource: Any) -> None:
    try:
        resource.close()
    except Exception:  # noqa: BLE001 - cleanup 상세를 provider 실패에 붙이지 않는다.
        return
