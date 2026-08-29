from __future__ import annotations

import json
import os
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID

import psycopg

from eatbid.core.postgres_repository import PsycopgCanonicalProjectionRepository
from eatbid.foundation import FoundationServices, run_foundation_slice
from eatbid.ingest.postgres_normalization_repository import (
    PsycopgNormalizationRepository,
)
from eatbid.ingest.postgres_publication_repository import PsycopgPublicationRepository
from eatbid.ingest.postgres_replay_repository import PsycopgReplayRunRepository
from eatbid.ingest.postgres_repository import PsycopgObservationRepository
from eatbid.object_store import (
    StoredRawObject,
    build_raw_object_key,
    parse_raw_object_key,
)
from eatbid.pipeline.replay import ReplayServices, replay_observations
from eatbid.postgres_foundation_repository import PsycopgFoundationCheckpointRepository
from eatbid.source.client import SourceResponse

CAPTURE_RUN_ID = UUID("13000000-0000-0000-0000-000000000201")
CAPTURE_PUBLICATION_ID = UUID("13000000-0000-0000-0000-000000000202")
REPLAY_RUN_ID = UUID("13000000-0000-0000-0000-000000000203")
REPLAY_PUBLICATION_ID = UUID("13000000-0000-0000-0000-000000000204")
BUILD_SHA = "d" * 64
STARTED_AT = datetime(2026, 8, 29, 4, 0, tzinfo=UTC)
FETCHED_AT = datetime(2026, 8, 29, 4, 1, tzinfo=UTC)
EXTERNAL_BID_ID = "task-13-runbook"


class FixtureStore:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    def put(self, *, source: str, endpoint: str, body: bytes) -> StoredRawObject:
        key = build_raw_object_key(source=source, endpoint=endpoint, body=body)
        self.objects[key] = body
        address = parse_raw_object_key(key)
        return StoredRawObject(
            content_sha256=address.content_sha256,
            object_key=key,
            byte_length=len(body),
            stored_at=FETCHED_AT,
        )

    def read(self, object_key: str) -> bytes:
        return self.objects[object_key]


class FixtureClient:
    def __init__(self, body: bytes) -> None:
        self.body = body

    def fetch(self, request: object) -> SourceResponse:
        return SourceResponse(200, self.body, FETCHED_AT)


def main() -> None:
    dsn = os.environ.get("EATBID_TASK13_DATABASE_URL")
    if not dsn:
        raise RuntimeError("EATBID_TASK13_DATABASE_URL is required")
    fixture = Path(__file__).parents[1] / "fixtures" / "eat" / "bid-detail-one.xml"
    body = fixture.read_bytes()
    store = FixtureStore()
    with psycopg.connect(dsn) as connection:
        capture = run_foundation_slice(
            run_id=CAPTURE_RUN_ID,
            publication_id=CAPTURE_PUBLICATION_ID,
            mode="poll-open",
            build_sha=BUILD_SHA,
            parser_version="eat-v1",
            started_at=STARTED_AT,
            normalized_at=datetime(2026, 8, 29, 4, 2, tzinfo=UTC),
            validated_at=datetime(2026, 8, 29, 4, 3, tzinfo=UTC),
            activated_at=datetime(2026, 8, 29, 4, 4, tzinfo=UTC),
            source="eat",
            endpoint="bid-detail",
            request_params={"ELCTRN_BID_ID": EXTERNAL_BID_ID},
            expected_count=1,
            services=FoundationServices(
                checkpoint_repository=PsycopgFoundationCheckpointRepository(connection),
                ingest_repository=PsycopgObservationRepository(connection),
                normalization_repository=PsycopgNormalizationRepository(connection),
                publication_repository=PsycopgPublicationRepository(connection),
                projection_repository=PsycopgCanonicalProjectionRepository(
                    connection, lambda: psycopg.connect(dsn)
                ),
                raw_store=store,
                source_client=FixtureClient(body),
            ),
        )
        replay = replay_observations(
            run_id=REPLAY_RUN_ID,
            publication_id=REPLAY_PUBLICATION_ID,
            observation_ids=capture.observation_ids,
            build_sha=BUILD_SHA,
            parser_version="eat-v1",
            started_at=datetime(2026, 8, 29, 4, 5, tzinfo=UTC),
            normalized_at=datetime(2026, 8, 29, 4, 6, tzinfo=UTC),
            validated_at=datetime(2026, 8, 29, 4, 7, tzinfo=UTC),
            activated_at=datetime(2026, 8, 29, 4, 8, tzinfo=UTC),
            services=ReplayServices(
                replay_repository=PsycopgReplayRunRepository(connection),
                normalization_repository=PsycopgNormalizationRepository(connection),
                publication_repository=PsycopgPublicationRepository(connection),
                projection_repository=PsycopgCanonicalProjectionRepository(
                    connection, lambda: psycopg.connect(dsn)
                ),
                store=store,
            ),
        )
        with connection.cursor() as cursor:
            cursor.execute(
                """
                select pr.normalized_record_id from ingest.publication_record pr
                where pr.publication_id = %s
                """,
                (CAPTURE_PUBLICATION_ID,),
            )
            normalized_record = cursor.fetchone()
        if normalized_record is None:
            raise RuntimeError("fixture publication member is missing")
    print(
        json.dumps(
            {
                "capture_run_id": str(capture.capture_run_id),
                "capture_publication_id": str(capture.publication_id),
                "replay_run_id": str(replay.run_id),
                "replay_publication_id": str(replay.publication_id),
                "observation_id": capture.observation_ids[0],
                "normalized_record_id": int(normalized_record[0]),
                "external_bid_id": EXTERNAL_BID_ID,
                "canonical_fingerprint": capture.canonical_fingerprint,
            },
            separators=(",", ":"),
        )
    )


if __name__ == "__main__":
    main()
