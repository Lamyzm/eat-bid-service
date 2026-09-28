"""모듈 책임: 한 공고의 시도·정규화·발행 구성원과 발행 제외 원장을 PostgreSQL에서 함께 잠그고, 그 묶음이
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
    # 격리된 시도만 값이 있다. 완결 검증기가 이 문장으로 레코드 범위인지 가른다(ADR 0061 결정 2).
    quarantine_reason: str | None = None


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
    def settled(self) -> bool:
        """모든 후보가 현재 parser의 최종 시도를 정확히 하나씩 갖고, 격리된 시도는 구성원을 하나도 내지 않는다.

        `coherent`와 따로 두는 이유: 발행이 격리를 원장의 제외로 넘길 수 있게 된 뒤에도(ADR 0061) 시도가
        없는 후보나 격리됐는데 구성원이 붙은 시도는 여전히 lineage의 결함이다. 둘을 한 판정에 섞으면
        "격리가 있다"와 "lineage가 깨졌다"가 같은 거짓이 되어 제외할 수 있는 창과 막아야 할 창을 가르지
        못한다. 격리가 레코드 범위이고 상한 안인지는 이 판정이 아니라 완결 검증기가 본다.
        """
        return self.partial_coherent and len(self.attempts) == len(self.candidate_ids)

    @property
    def coherent(self) -> bool:
        """Require the settled invariant plus one normalized attempt per candidate."""
        return self.settled and all(
            attempt.status == "normalized" for attempt in self.attempts
        )

    @property
    def quarantined_attempts(self) -> tuple[LockedNormalizationAttempt, ...]:
        """현재 parser의 격리된 시도를 관측 순서로 돌려준다. 발행 제외 원장과 대조할 대상이다."""
        return tuple(
            attempt
            for attempt in self.current_attempts
            if attempt.status == "quarantined"
        )

    @property
    def quarantined_observation_ids(self) -> tuple[int, ...]:
        return tuple(attempt.observation_id for attempt in self.quarantined_attempts)

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
            for no key update of ri, o
            """,
            (run_id,),
        )
    else:
        cursor.execute(
            """
            select observation_id from ingest.raw_observation
            where run_id = %s order by observation_id for no key update
            """,
            (run_id,),
        )
    candidate_ids = tuple(int(row[0]) for row in cursor.fetchall())

    cursor.execute(
        """
        select a.normalization_attempt_id, a.observation_id,
               a.parser_version, a.status, o.source, o.endpoint,
               a.schema_fingerprint, a.quarantine_reason
        from ingest.normalization_attempt a
        join ingest.raw_observation o using (observation_id)
        where a.run_id = %s
        order by a.observation_id, a.normalization_attempt_id
        for no key update of a, o
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
            quarantine_reason=(str(row[7]) if row[7] is not None else None),
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
            for no key update of a, ar, n
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


@dataclass(frozen=True, slots=True)
class LockedExclusion:
    """발행 제외 원장의 한 행 중 봉인과 지문에 드는 부분이다."""

    observation_id: int
    stage: str
    reason_code: str


def lock_publication_exclusions(
    cursor: psycopg.Cursor[Any], *, publication_id: UUID
) -> tuple[LockedExclusion, ...]:
    """발행 하나의 제외 원장 행을 잠그고 관측 id 오름차순으로 돌려준다.

    검증·투영·replay 재개가 같은 질의로 원장을 읽어야 "봉인된 제외"가 한 정의가 된다. 호출자는 이 목록이
    지금 격리된 시도의 관측과 정확히 같은지 대조한다 — 원장에 없는 결손이나 격리 없는 제외는 둘 다 발행을
    멈춘다(ADR 0061 결정 4). 원장은 core가 아니라 ingest 표지만 core는 ingest 모듈을 부르지 않으므로
    읽기는 lineage 잠금과 같은 이 모듈이 갖는다.
    """
    cursor.execute(
        """
        select observation_id, stage, reason_code
        from ingest.publication_exclusion
        where publication_id = %s
        order by observation_id
        for no key update
        """,
        (publication_id,),
    )
    return tuple(
        LockedExclusion(
            observation_id=int(row[0]), stage=str(row[1]), reason_code=str(row[2])
        )
        for row in cursor.fetchall()
    )
