"""모듈 책임: source release PostgreSQL dataset row를 domain completeness 값으로 닫는다."""

from __future__ import annotations

from typing import Any
from uuid import UUID

import psycopg

from eatbid.ingest.release_models import ReleaseCompleteness
from eatbid.ingest.release_repository import ReleaseSourceMismatchError


def lock_observation_source(
    cursor: psycopg.Cursor[Any], observation_id: int
) -> str | None:
    cursor.execute(
        "select source from ingest.raw_observation where observation_id = %s for update",
        (observation_id,),
    )
    row = cursor.fetchone()
    return None if row is None else str(row[0])


def load_release_observations(
    cursor: psycopg.Cursor[Any],
    source_release_id: UUID,
    *,
    release_source: str,
) -> tuple[tuple[int, str], ...]:
    cursor.execute(
        """
        select member.observation_id, observation.content_sha256,
               observation.source
        from ingest.source_release_observation member
        join ingest.raw_observation observation
          on observation.observation_id = member.observation_id
        where member.source_release_id = %s
        order by member.observation_id, observation.content_sha256
        for update of observation
        """,
        (source_release_id,),
    )
    rows = cursor.fetchall()
    for row in rows:
        observation_source = str(row[2])
        if observation_source != release_source:
            raise ReleaseSourceMismatchError(
                release_source=release_source,
                observation_source=observation_source,
            )
    return tuple((int(row[0]), str(row[1])) for row in rows)


def load_release_datasets(
    cursor: psycopg.Cursor[Any], source_release_id: UUID
) -> tuple[ReleaseCompleteness, ...]:
    cursor.execute(
        """
        select endpoint, dataset, record_type, parser_version,
               schema_fingerprint, expected_count, observed_count,
               normalized_count, quarantined_count, required
        from ingest.source_release_dataset
        where source_release_id = %s
        order by dataset, endpoint, record_type, parser_version,
                 schema_fingerprint
        """,
        (source_release_id,),
    )
    return tuple(
        ReleaseCompleteness(
            endpoint=str(row[0]),
            dataset=str(row[1]),
            record_type=str(row[2]),
            parser_version=str(row[3]),
            schema_fingerprint=str(row[4]),
            expected_count=int(row[5]),
            observed_count=int(row[6]),
            normalized_count=int(row[7]),
            quarantined_count=int(row[8]),
            required=bool(row[9]),
        )
        for row in cursor.fetchall()
    )
