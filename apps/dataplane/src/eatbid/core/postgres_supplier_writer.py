"""모듈 책임: 관측된 업체 계정을 `core.source_supplier_account`에 앉히고 `core.supplier_party`
승격 규칙(사업자번호가 유일 키, 없으면 계정마다 별도 party, 자동 병합 금지)을 집행한다.

승격 규칙이 명단 writer와 섞이면 "명단을 옮기다가 업체 정체성이 생기는" 코드가 되고, 병합 정책을
바꿀 때 무엇을 함께 읽어야 하는지가 흐려진다(ADR 0033 §1).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

import psycopg

from eatbid.core.postgres_code_values import resolve_code_value, resolve_observation
from eatbid.core.projection_models import (
    AppliedProjectionCounts,
    SupplierAccountProjection,
)
from eatbid.core.repository import ProjectionContractError

# 새 party의 유형이다. 라벨(`SHIPPER_NM`)에서 유형을 승격하지 않는다 — 이름은 관측이고 유형은 판정이다.
_UNKNOWN_PARTY_TYPE = "unknown"


@dataclass(frozen=True, slots=True)
class ResolvedSupplier:
    """명단·낙찰 행이 비정규화해 들고 갈 계정·party 짝이다."""

    source_supplier_account_id: int
    supplier_party_id: int


class SupplierProjectionWriter:
    """계정 하나를 insert-or-verify 하고 그 party를 승격 규칙대로 고른다."""

    def resolve(
        self,
        cursor: psycopg.Cursor[Any],
        supplier: SupplierAccountProjection,
        *,
        observation_id: int,
        observed_at: datetime,
        allow_insert: bool,
    ) -> tuple[ResolvedSupplier, AppliedProjectionCounts]:
        account_code_value_id, code_values, code_labels = resolve_observation(
            cursor,
            supplier.account,
            observation_id=observation_id,
            observed_at=observed_at,
            allow_insert=allow_insert,
        )
        business_number_code_value_id: int | None = None
        if supplier.business_number is not None:
            business_number_code_value_id, inserted = resolve_code_value(
                cursor,
                namespace=supplier.business_number.namespace,
                code=supplier.business_number.code,
                allow_insert=allow_insert,
            )
            code_values += inserted

        existing = self._locked_account(cursor, account_code_value_id)
        if existing is not None:
            resolved = self._verify_existing(
                existing,
                supplier=supplier,
                business_number_code_value_id=business_number_code_value_id,
            )
            return resolved, AppliedProjectionCounts(
                code_values=code_values, code_labels=code_labels
            )
        if not allow_insert:
            raise ProjectionContractError("published supplier account is missing")

        supplier_party_id, parties_inserted = self._resolve_party(
            cursor, business_number_code_value_id=business_number_code_value_id
        )
        cursor.execute(
            """
            insert into core.source_supplier_account (
                supplier_party_id, source_system, account_code_value_id, observation_id
            ) values (%s, %s, %s, %s)
            returning source_supplier_account_id
            """,
            (
                supplier_party_id,
                supplier.source_system,
                account_code_value_id,
                observation_id,
            ),
        )
        inserted_account = cursor.fetchone()
        if inserted_account is None:
            raise ProjectionContractError("supplier account insertion returned no identity")
        return (
            ResolvedSupplier(
                source_supplier_account_id=int(inserted_account[0]),
                supplier_party_id=supplier_party_id,
            ),
            AppliedProjectionCounts(
                code_values=code_values,
                code_labels=code_labels,
                supplier_parties=parties_inserted,
                supplier_accounts=1,
            ),
        )

    @staticmethod
    def _locked_account(
        cursor: psycopg.Cursor[Any], account_code_value_id: int
    ) -> tuple[int, int, str, int | None] | None:
        cursor.execute(
            """
            select a.source_supplier_account_id, a.supplier_party_id, a.source_system,
                   p.business_number_code_value_id
            from core.source_supplier_account a
            join core.supplier_party p using (supplier_party_id)
            where a.account_code_value_id = %s
            for update of a, p
            """,
            (account_code_value_id,),
        )
        row = cursor.fetchone()
        if row is None:
            return None
        return (
            int(row[0]),
            int(row[1]),
            str(row[2]),
            int(row[3]) if row[3] is not None else None,
        )

    @staticmethod
    def _verify_existing(
        existing: tuple[int, int, str, int | None],
        *,
        supplier: SupplierAccountProjection,
        business_number_code_value_id: int | None,
    ) -> ResolvedSupplier:
        """이미 승격된 계정은 값을 다시 쓰지 않고 어긋남만 본다.

        사업자번호가 이제서야 관측되었더라도 기존 party에 붙이지 않는다. 그 병합은 `code_mapping`과
        같은 급의 명시적 reconciliation이며 이 경로의 권한 밖이다(ADR 0033 §1, AGENTS 3).
        """
        account_id, party_id, source_system, party_business_number = existing
        if source_system != supplier.source_system:
            raise ProjectionContractError("persisted supplier account source differs")
        if (
            business_number_code_value_id is not None
            and party_business_number is not None
            and business_number_code_value_id != party_business_number
        ):
            raise ProjectionContractError("persisted supplier party identity conflicts")
        return ResolvedSupplier(
            source_supplier_account_id=account_id, supplier_party_id=party_id
        )

    @staticmethod
    def _resolve_party(
        cursor: psycopg.Cursor[Any], *, business_number_code_value_id: int | None
    ) -> tuple[int, int]:
        """사업자번호가 있으면 그것이 party의 유일 키이고, 없으면 이 계정이 자기 party를 갖는다."""
        if business_number_code_value_id is None:
            cursor.execute(
                """
                insert into core.supplier_party (type, canonical_name)
                values (%s, null) returning supplier_party_id
                """,
                (_UNKNOWN_PARTY_TYPE,),
            )
            inserted = cursor.fetchone()
            if inserted is None:
                raise ProjectionContractError("supplier party insertion returned no identity")
            return int(inserted[0]), 1
        cursor.execute(
            """
            insert into core.supplier_party (
                type, canonical_name, business_number_code_value_id
            ) values (%s, null, %s)
            on conflict (business_number_code_value_id) do nothing
            returning supplier_party_id
            """,
            (_UNKNOWN_PARTY_TYPE, business_number_code_value_id),
        )
        inserted = cursor.fetchone()
        if inserted is not None:
            return int(inserted[0]), 1
        cursor.execute(
            """
            select supplier_party_id from core.supplier_party
            where business_number_code_value_id = %s for update
            """,
            (business_number_code_value_id,),
        )
        existing = cursor.fetchone()
        if existing is None:
            raise ProjectionContractError("published supplier party is missing")
        return int(existing[0]), 0
