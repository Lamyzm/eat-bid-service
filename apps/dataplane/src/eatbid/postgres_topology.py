"""모듈 책임: 한 공고의 시도·정규화·발행 구성원을 PostgreSQL에서 함께 잠그고, 그 묶음이
발행 가능한 모양인지 판정한다."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from uuid import UUID

import psycopg

from eatbid.core.record_types import is_projectable_record_type


@dataclass(frozen=True, slots=True)
class LockedNormalizationAttempt:
    attempt_id: int
    observation_id: int
    parser_version: str
    status: str
    source: str
    endpoint: str
    schema_fingerprint: str | None


@dataclass(frozen=True, slots=True)
class LockedAuctionMember:
    attempt_id: int
    attempt_observation_id: int
    normalized_record_id: int
    observation_id: int
    source_entity_id: str
    parser_version: str
    record_type: str


@dataclass(frozen=True, slots=True)
class LockedAuctionTopology:
    candidate_ids: tuple[int, ...]
    attempts: tuple[LockedNormalizationAttempt, ...]
    current_attempts: tuple[LockedNormalizationAttempt, ...]
    members: tuple[LockedAuctionMember, ...]
    member_ids: tuple[int, ...]

    @property
    def partial_coherent(self) -> bool:
        """Accept an incomplete checkpoint only when its existing lineage is exact."""
        candidate_set = set(self.candidate_ids)
        attempt_observation_ids = tuple(
            attempt.observation_id for attempt in self.attempts
        )
        attempt_by_id = {attempt.attempt_id: attempt for attempt in self.attempts}
        members_by_attempt: dict[int, list[LockedAuctionMember]] = {
            attempt_id: [] for attempt_id in attempt_by_id
        }
        for member in self.members:
            owned = members_by_attempt.get(member.attempt_id)
            if owned is None:
                return False
            owned.append(member)

        if (
            len(candidate_set) != len(self.candidate_ids)
            or any(
                observation_id not in candidate_set
                for observation_id in attempt_observation_ids
            )
            or len(attempt_observation_ids) != len(set(attempt_observation_ids))
            or self.attempts != self.current_attempts
            or self.member_ids
            != tuple(sorted(member.normalized_record_id for member in self.members))
        ):
            return False

        for attempt in self.attempts:
            owned = members_by_attempt[attempt.attempt_id]
            if attempt.status == "quarantined":
                if owned:
                    return False
                continue
            if attempt.status != "normalized" or len(owned) != 1:
                return False
            member = owned[0]
            if (
                member.attempt_observation_id != attempt.observation_id
                or member.observation_id != attempt.observation_id
                or member.parser_version != attempt.parser_version
                or not is_projectable_record_type(member.record_type)
            ):
                return False
        return True

    @property
    def coherent(self) -> bool:
        """Require the partial invariant plus one normalized attempt per candidate."""
        return (
            self.partial_coherent
            and len(self.attempts) == len(self.candidate_ids)
            and all(attempt.status == "normalized" for attempt in self.attempts)
        )

    @property
    def missing_current_attempts(self) -> int:
        return max(0, len(self.candidate_ids) - len(self.current_attempts))

    @property
    def quarantined_current_attempts(self) -> int:
        return sum(attempt.status == "quarantined" for attempt in self.current_attempts)

    @property
    def parser_mismatches(self) -> int:
        return len(self.attempts) - len(self.current_attempts)


def lock_auction_topology(
    cursor: psycopg.Cursor[Any],
    *,
    run_id: UUID,
    run_mode: str,
    parser_version: str,
) -> LockedAuctionTopology:
    """Lock and describe the exact candidate/current-parser auction lineage."""
    if run_mode == "replay":
        cursor.execute(
            """
            select o.observation_id
            from ingest.replay_input ri
            join ingest.raw_observation o on o.observation_id = ri.observation_id
            where ri.run_id = %s
            order by o.observation_id
            for update of ri, o
            """,
            (run_id,),
        )
    else:
        cursor.execute(
            """
            select observation_id from ingest.raw_observation
            where run_id = %s order by observation_id for update
            """,
            (run_id,),
        )
    candidate_ids = tuple(int(row[0]) for row in cursor.fetchall())

    cursor.execute(
        """
        select a.normalization_attempt_id, a.observation_id,
               a.parser_version, a.status, o.source, o.endpoint,
               a.schema_fingerprint
        from ingest.normalization_attempt a
        join ingest.raw_observation o using (observation_id)
        where a.run_id = %s
        order by a.observation_id, a.normalization_attempt_id
        for update of a, o
        """,
        (run_id,),
    )
    attempts = tuple(
        LockedNormalizationAttempt(
            attempt_id=int(row[0]),
            observation_id=int(row[1]),
            parser_version=str(row[2]),
            status=str(row[3]),
            source=str(row[4]),
            endpoint=str(row[5]),
            schema_fingerprint=(str(row[6]) if row[6] is not None else None),
        )
        for row in cursor.fetchall()
    )
    current_attempts = tuple(
        attempt for attempt in attempts if attempt.parser_version == parser_version
    )
    current_attempt_ids = tuple(attempt.attempt_id for attempt in current_attempts)
    if current_attempt_ids:
        cursor.execute(
            """
            select a.normalization_attempt_id, a.observation_id,
                   n.normalized_record_id, n.observation_id,
                   n.source_entity_id, n.parser_version, n.record_type
            from ingest.normalization_attempt a
            join ingest.normalization_attempt_record ar
              on ar.normalization_attempt_id = a.normalization_attempt_id
            join ingest.normalized_record n
              on n.normalized_record_id = ar.normalized_record_id
            where a.normalization_attempt_id = any(%s)
            order by a.normalization_attempt_id, n.normalized_record_id
            for update of a, ar, n
            """,
            (list(current_attempt_ids),),
        )
        members = tuple(
            LockedAuctionMember(
                attempt_id=int(row[0]),
                attempt_observation_id=int(row[1]),
                normalized_record_id=int(row[2]),
                observation_id=int(row[3]),
                source_entity_id=str(row[4]),
                parser_version=str(row[5]),
                record_type=str(row[6]),
            )
            for row in cursor.fetchall()
        )
    else:
        members = ()

    return LockedAuctionTopology(
        candidate_ids=candidate_ids,
        attempts=attempts,
        current_attempts=current_attempts,
        members=members,
        member_ids=tuple(sorted(member.normalized_record_id for member in members)),
    )
