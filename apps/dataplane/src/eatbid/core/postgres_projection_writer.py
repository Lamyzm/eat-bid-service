from __future__ import annotations

import json
import re
from datetime import datetime
from typing import Any

import psycopg
from psycopg.types.json import Jsonb

from eatbid.core.models import AuctionProjection
from eatbid.core.repository import ProjectionContractError


class CanonicalProjectionWriter:
    """Insert-or-verify canonical rows within the caller's locked transaction."""

    def apply(
        self,
        cursor: psycopg.Cursor[Any],
        *,
        projection: AuctionProjection,
        observed_at: datetime,
        allow_insert: bool,
    ) -> tuple[int, int, int, int, int, int]:
        _validate_projection(projection)
        organization_code_id, organization_code_inserted = self._resolve_code_value(
            cursor,
            namespace="eat:organization",
            code=projection.organization_code,
            allow_insert=allow_insert,
        )
        organization_id, organization_inserted = self._resolve_organization(
            cursor,
            code_value_id=organization_code_id,
            observation_id=projection.observation_id,
            allow_insert=allow_insert,
        )
        label_inserted = self._resolve_label(
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
            code_value_id, inserted = self._resolve_code_value(
                cursor,
                namespace=reference.namespace,
                code=reference.code,
                allow_insert=allow_insert,
            )
            code_values_inserted += inserted
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
        return (
            attempt_inserted,
            revision_inserted,
            organization_inserted,
            code_values_inserted,
            label_inserted,
            relationships_inserted,
        )

    @staticmethod
    def _resolve_code_value(
        cursor: psycopg.Cursor[Any],
        *,
        namespace: str,
        code: str,
        allow_insert: bool,
    ) -> tuple[int, int]:
        cursor.execute(
            "select code_scheme_id from core.code_scheme where namespace = %s",
            (namespace,),
        )
        scheme = cursor.fetchone()
        if scheme is None:
            raise ProjectionContractError(
                f"reviewed code scheme is missing: {namespace}"
            )
        scheme_id = int(scheme[0])
        if allow_insert:
            cursor.execute(
                """
                insert into core.code_value (code_scheme_id, code)
                values (%s, %s)
                on conflict (code_scheme_id, code) do nothing
                returning code_value_id
                """,
                (scheme_id, code),
            )
            inserted = cursor.fetchone()
            if inserted is not None:
                return int(inserted[0]), 1
        cursor.execute(
            """
            select code_value_id from core.code_value
            where code_scheme_id = %s and code = %s for update
            """,
            (scheme_id, code),
        )
        existing = cursor.fetchone()
        if existing is None:
            raise ProjectionContractError(
                f"published code value is missing: {namespace}/{code}"
            )
        return int(existing[0]), 0

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
    def _resolve_label(
        cursor: psycopg.Cursor[Any],
        *,
        code_value_id: int,
        label: str,
        observation_id: int,
        observed_at: datetime,
        allow_insert: bool,
    ) -> int:
        if allow_insert:
            cursor.execute(
                """
                insert into core.code_label_observation (
                    code_value_id, label, language, observed_at, observation_id
                ) values (%s, %s, 'und', %s, %s)
                on conflict (code_value_id, label, language, observation_id) do nothing
                returning code_label_observation_id
                """,
                (code_value_id, label, observed_at, observation_id),
            )
            inserted = cursor.fetchone()
            if inserted is not None:
                return 1
        cursor.execute(
            """
            select observed_at from core.code_label_observation
            where code_value_id = %s and label = %s and language = 'und'
              and observation_id = %s
            for update
            """,
            (code_value_id, label, observation_id),
        )
        existing = cursor.fetchone()
        if existing is None or existing[0] != observed_at:
            raise ProjectionContractError("organization label evidence conflicts")
        return 0

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
                    planned_amount, currency, source_payload
                ) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
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
                   planned_amount, currency, source_payload
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
            projection.currency,
        )
        actual = tuple(existing[1:13])
        if actual != expected or _canonical_json(existing[13]) != _canonical_json(
            projection.source_payload
        ):
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


def _canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


_SHA256 = re.compile(r"[0-9a-f]{64}")
_REVIEWED_CODE_ROLES = {
    "eat:auction-location-sido": "location_sido",
    "eat:auction-location-sigungu": "location_sigungu",
    "eat:eligibility-area": "eligibility_area",
}


def _validate_projection(projection: AuctionProjection) -> None:
    if projection.normalized_record_id <= 0 or projection.observation_id <= 0:
        raise ProjectionContractError("projection lineage IDs must be positive")
    required = {
        "source_system": projection.source_system,
        "endpoint": projection.endpoint,
        "parser_version": projection.parser_version,
        "external_bid_id": projection.external_bid_id,
        "organization_code": projection.organization_code,
        "organization_label": projection.organization_label,
        "source_status": projection.source_status,
        "title": projection.title,
        "currency": projection.currency,
    }
    if any(
        not isinstance(value, str) or not value.strip() for value in required.values()
    ):
        raise ProjectionContractError("projection required strings must be non-empty")
    for digest in (
        projection.raw_content_sha256,
        projection.normalized_payload_sha256,
    ):
        if not isinstance(digest, str) or _SHA256.fullmatch(digest) is None:
            raise ProjectionContractError("projection hashes must be lowercase SHA-256")
    if not isinstance(projection.source_payload, dict):
        raise ProjectionContractError("projection source payload must be a JSON object")
    try:
        _canonical_json(projection.source_payload)
    except (TypeError, ValueError) as error:
        raise ProjectionContractError(
            "projection source payload must be JSON serializable"
        ) from error
    identities: set[tuple[str, str, str]] = set()
    for reference in projection.code_refs:
        if (
            _REVIEWED_CODE_ROLES.get(reference.namespace) != reference.role
            or not reference.code.strip()
        ):
            raise ProjectionContractError("projection code reference is not reviewed")
        identity = (reference.namespace, reference.code, reference.role)
        if identity in identities:
            raise ProjectionContractError(
                "projection code references must be deduplicated"
            )
        identities.add(identity)
