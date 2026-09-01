"""모듈 책임: downstream command의 source release membership과 sealed 상태를 조회 검증한다."""

from __future__ import annotations

from typing import Any
from uuid import UUID

import psycopg

from eatbid.ingest.release_repository import (
    ReleaseIncompleteError,
    ReleaseNotFoundError,
    ReleaseObservationMembershipError,
)


class PostgresReleaseGuardMixin:
    _connection: psycopg.Connection[Any]

    def require_observation_member(
        self, source_release_id: UUID, observation_id: int
    ) -> None:
        with self._connection.transaction(), self._connection.cursor() as cursor:
            cursor.execute(
                """
                select 1 from ingest.source_release_observation
                where source_release_id = %s and observation_id = %s
                """,
                (source_release_id, observation_id),
            )
            if cursor.fetchone() is None:
                raise ReleaseObservationMembershipError(
                    "observation is not a member of the source release"
                )

    def require_sealed(self, source_release_id: UUID) -> None:
        with self._connection.transaction(), self._connection.cursor() as cursor:
            cursor.execute(
                "select status from ingest.source_release where source_release_id = %s",
                (source_release_id,),
            )
            row = cursor.fetchone()
            if row is None:
                raise ReleaseNotFoundError("source release does not exist")
            if row[0] != "sealed":
                raise ReleaseIncompleteError("source release is not sealed")
