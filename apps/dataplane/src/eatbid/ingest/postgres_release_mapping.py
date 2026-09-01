"""모듈 책임: source release PostgreSQL dataset row를 domain completeness 값으로 닫는다."""

from __future__ import annotations

from typing import Any
from uuid import UUID

import psycopg

from eatbid.ingest.release_models import ReleaseCompleteness


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
