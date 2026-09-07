"""모듈 책임: 공고 한 건의 투영을 호출자가 잠근 트랜잭션 안에서 attempt·revision·기관 관계로
앉히고, v2 투영이면 명단·낙찰·사슬 writer를 같은 커서로 잇는다.

값 검증은 `projection_validation`, 코드 해소는 `postgres_code_values`, 명단 grain은
`postgres_roster_writer`·`postgres_supplier_writer`·`postgres_lineage_writer`가 각각 소유한다.
여기 남는 것은 "무엇을 어떤 순서로 잠그고 쓰는가"뿐이다.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

import psycopg
from psycopg.types.json import Jsonb

from eatbid.core.models import AuctionProjection
from eatbid.core.postgres_code_values import resolve_code_value, resolve_label
from eatbid.core.postgres_lineage_writer import LineageProjectionWriter
from eatbid.core.postgres_roster_writer import RosterProjectionWriter
from eatbid.core.projection_models import (
    AppliedProjectionCounts,
    AuctionV2Projection,
    comparable_row,
)
from eatbid.core.projection_validation import canonical_json, validate_projection
from eatbid.core.repository import ProjectionContractError
from eatbid.source.eat.code_schemes import ORGANIZATION

__all__ = ["CanonicalProjectionWriter", "validate_projection"]


class CanonicalProjectionWriter:
    """Insert-or-verify canonical rows within the caller's locked transaction."""

    def __init__(
        self,
        roster: RosterProjectionWriter | None = None,
        lineage: LineageProjectionWriter | None = None,
    ) -> None:
        self._roster = roster or RosterProjectionWriter()
        self._lineage = lineage or LineageProjectionWriter()

    def apply(
        self,
        cursor: psycopg.Cursor[Any],
        *,
        projection: AuctionProjection,
        observed_at: datetime,
        allow_insert: bool,
    ) -> AppliedProjectionCounts:
        validate_projection(projection)
        organization_code_id, organization_code_inserted = resolve_code_value(
            cursor,
            namespace=ORGANIZATION.namespace,
            code=projection.organization_code,
            allow_insert=allow_insert,
        )
        organization_id, organization_inserted = self._resolve_organization(
            cursor,
            code_value_id=organization_code_id,
            observation_id=projection.observation_id,
            allow_insert=allow_insert,
        )
        label_inserted = resolve_label(
            cursor,
            code_value_id=organization_code_id,
            label=projection.organization_label,
            observation_id=projection.observation_id,
            observed_at=observed_at,
            allow_insert=allow_insert,
        )
        attempt_id, attempt_inserted = self._resolve_attempt(
            cursor, projection=projection, allow_insert=allow_insert
        )
        revision_id, revision_inserted = self._resolve_revision(
            cursor,
            attempt_id=attempt_id,
            projection=projection,
            allow_insert=allow_insert,
        )
        relationships_inserted = self._resolve_relationship(
            cursor,
            table="auction_organization",
            values=(revision_id, organization_id, "purchaser"),
            allow_insert=allow_insert,
        )
        code_values_inserted = organization_code_inserted
        expected_code_relationships: set[tuple[int, str]] = set()
        for reference in projection.code_refs:
            code_value_id, inserted = resolve_code_value(
                cursor,
                namespace=reference.namespace,
                code=reference.code,
                allow_insert=allow_insert,
            )
            code_values_inserted += inserted
            if reference.label is not None:
                # 라벨은 코드 관계가 아니라 이 관측이 남긴 증거라 관계 집합 검증 밖에 둔다. 같은 코드를
                # 다른 이름으로 부른 관측이 있어도 행이 늘 뿐 충돌이 아니다(AGENTS 3).
                label_inserted += resolve_label(
                    cursor,
                    code_value_id=code_value_id,
                    label=reference.label,
                    observation_id=projection.observation_id,
                    observed_at=observed_at,
                    allow_insert=allow_insert,
                )
            expected_code_relationships.add((code_value_id, reference.role))
            relationships_inserted += self._resolve_relationship(
                cursor,
                table="auction_revision_code_value",
                values=(revision_id, code_value_id, reference.role),
                allow_insert=allow_insert,
            )
        self._verify_relationship_sets(
            cursor,
            revision_id=revision_id,
            organization_id=organization_id,
            code_relationships=expected_code_relationships,
        )
        counts = AppliedProjectionCounts(
            auction_attempts=attempt_inserted,
            auction_revisions=revision_inserted,
            organizations=organization_inserted,
            code_values=code_values_inserted,
            code_labels=label_inserted,
            relationships=relationships_inserted,
        )
        if isinstance(projection, AuctionV2Projection):
            counts += self._roster.apply(
                cursor,
                projection=projection,
                revision_id=revision_id,
                attempt_id=attempt_id,
                observed_at=observed_at,
                allow_insert=allow_insert,
            )
            counts += self._lineage.apply(
                cursor,
                projection=projection,
                revision_id=revision_id,
                attempt_id=attempt_id,
                allow_insert=allow_insert,
            )
        return counts

    @staticmethod
    def _resolve_organization(
        cursor: psycopg.Cursor[Any],
        *,
        code_value_id: int,
        observation_id: int,
        allow_insert: bool,
    ) -> tuple[int, int]:
        cursor.execute(
            """
            select oi.organization_id
            from core.organization_identifier oi
            join core.organization o using (organization_id)
            where oi.code_value_id = %s
            for update of oi, o
            """,
            (code_value_id,),
        )
        existing = cursor.fetchone()
        if existing is not None:
            return int(existing[0]), 0
        if not allow_insert:
            raise ProjectionContractError("published organization identity is missing")
        cursor.execute(
            """
            insert into core.organization (type, canonical_name)
            values ('unknown', null) returning organization_id
            """
        )
        inserted = cursor.fetchone()
        if inserted is None:
            raise ProjectionContractError("organization insertion returned no identity")
        organization_id = int(inserted[0])
        cursor.execute(
            """
            insert into core.organization_identifier (
                organization_id, code_value_id, observation_id
            ) values (%s, %s, %s)
            """,
            (organization_id, code_value_id, observation_id),
        )
        return organization_id, 1

    @staticmethod
    def _resolve_attempt(
        cursor: psycopg.Cursor[Any],
        *,
        projection: AuctionProjection,
        allow_insert: bool,
    ) -> tuple[int, int]:
        if allow_insert:
            cursor.execute(
                """
                insert into core.auction_attempt (source_system, external_bid_id)
                values (%s, %s)
                on conflict (source_system, external_bid_id) do nothing
                returning auction_attempt_id
                """,
                (projection.source_system, projection.external_bid_id),
            )
            inserted = cursor.fetchone()
            if inserted is not None:
                return int(inserted[0]), 1
        cursor.execute(
            """
            select auction_attempt_id from core.auction_attempt
            where source_system = %s and external_bid_id = %s for update
            """,
            (projection.source_system, projection.external_bid_id),
        )
        existing = cursor.fetchone()
        if existing is None:
            raise ProjectionContractError("published auction attempt is missing")
        return int(existing[0]), 0

    @staticmethod
    def _resolve_revision(
        cursor: psycopg.Cursor[Any],
        *,
        attempt_id: int,
        projection: AuctionProjection,
        allow_insert: bool,
    ) -> tuple[int, int]:
        values = (
            attempt_id,
            projection.normalized_record_id,
            projection.observation_id,
            projection.raw_content_sha256,
            projection.display_bid_no,
            projection.source_status,
            projection.title,
            projection.announced_at,
            projection.deadline_at,
            projection.opened_at,
            projection.base_amount,
            projection.planned_amount,
            projection.floor_rate,
            projection.currency,
            Jsonb(dict(projection.source_payload)),
        )
        if allow_insert:
            cursor.execute(
                """
                insert into core.auction_revision (
                    auction_attempt_id, normalized_record_id, observation_id,
                    content_sha256, display_bid_no, source_status, title,
                    announced_at, deadline_at, opened_at, base_amount,
                    planned_amount, floor_rate, currency, source_payload
                ) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                on conflict (normalized_record_id) do nothing
                returning auction_revision_id
                """,
                values,
            )
            inserted = cursor.fetchone()
            if inserted is not None:
                return int(inserted[0]), 1
        cursor.execute(
            """
            select auction_revision_id, auction_attempt_id, observation_id,
                   content_sha256, display_bid_no, source_status, title,
                   announced_at, deadline_at, opened_at, base_amount,
                   planned_amount, floor_rate, currency, source_payload
            from core.auction_revision where normalized_record_id = %s for update
            """,
            (projection.normalized_record_id,),
        )
        existing = cursor.fetchone()
        if existing is None:
            raise ProjectionContractError("published auction revision is missing")
        expected = (
            attempt_id,
            projection.observation_id,
            projection.raw_content_sha256,
            projection.display_bid_no,
            projection.source_status,
            projection.title,
            projection.announced_at,
            projection.deadline_at,
            projection.opened_at,
            projection.base_amount,
            projection.planned_amount,
            projection.floor_rate,
            projection.currency,
        )
        # 열의 자릿수를 붙여 돌아오는 `numeric`을 값의 차이로 읽으면 멱등한 재발행이 끊긴다.
        actual = comparable_row(existing[1:14])
        if actual != comparable_row(expected) or canonical_json(
            existing[14]
        ) != canonical_json(projection.source_payload):
            raise ProjectionContractError("persisted auction revision conflicts")
        return int(existing[0]), 0

    @staticmethod
    def _resolve_relationship(
        cursor: psycopg.Cursor[Any],
        *,
        table: str,
        values: tuple[int, int, str],
        allow_insert: bool,
    ) -> int:
        if table == "auction_organization":
            columns = "auction_revision_id, organization_id, role"
        elif table == "auction_revision_code_value":
            columns = "auction_revision_id, code_value_id, role"
        else:
            raise AssertionError("unsupported canonical relationship")
        if allow_insert:
            cursor.execute(
                f"insert into core.{table} ({columns}) values (%s, %s, %s) "
                "on conflict do nothing returning 1",
                values,
            )
            if cursor.fetchone() is not None:
                return 1
        cursor.execute(
            f"select 1 from core.{table} where auction_revision_id = %s "
            f"and {columns.split(', ')[1]} = %s and role = %s for update",
            values,
        )
        if cursor.fetchone() is None:
            raise ProjectionContractError(f"published {table} relationship is missing")
        return 0

    @staticmethod
    def _verify_relationship_sets(
        cursor: psycopg.Cursor[Any],
        *,
        revision_id: int,
        organization_id: int,
        code_relationships: set[tuple[int, str]],
    ) -> None:
        cursor.execute(
            "select organization_id, role from core.auction_organization "
            "where auction_revision_id = %s order by organization_id, role for update",
            (revision_id,),
        )
        organizations = {(int(row[0]), str(row[1])) for row in cursor.fetchall()}
        if organizations != {(organization_id, "purchaser")}:
            raise ProjectionContractError("purchaser relationship set conflicts")
        cursor.execute(
            "select code_value_id, role from core.auction_revision_code_value "
            "where auction_revision_id = %s order by code_value_id, role for update",
            (revision_id,),
        )
        codes = {(int(row[0]), str(row[1])) for row in cursor.fetchall()}
        if codes != code_relationships:
            raise ProjectionContractError("code-value relationship set conflicts")
