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

        # 사업자번호가 있으면 party를 먼저 정한다. 그것이 이 관측이 말하는 업체이며, 계정은 시점에 따라
        # 다른 업체로 관측될 수 있으므로 계정만으로 기존 행을 찾으면 안 된다(ADR 0049).
        supplier_party_id, parties_inserted = self._resolve_party(
            cursor,
            business_number_code_value_id=business_number_code_value_id,
            allow_insert=allow_insert,
        )
        existing = self._locked_account(cursor, account_code_value_id, supplier_party_id)
        if existing is not None:
            resolved = self._verify_existing(existing, supplier=supplier)
            return resolved, AppliedProjectionCounts(
                code_values=code_values,
                code_labels=code_labels,
                supplier_parties=parties_inserted,
            )
        if not allow_insert:
            raise ProjectionContractError("published supplier account is missing")

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
        cursor: psycopg.Cursor[Any], account_code_value_id: int, supplier_party_id: int
    ) -> tuple[int, int, str] | None:
        """이 관측이 말하는 `(계정, party)` 짝의 행을 찾는다.

        계정만으로 찾으면 같은 계정의 다른 시점 행이 걸린다. 그 행과 지금 관측이 다르다고 멈추던 것이
        2025-11 창을 두 번 버린 원인이다(ADR 0049).
        """
        cursor.execute(
            """
            select a.source_supplier_account_id, a.supplier_party_id, a.source_system
            from core.source_supplier_account a
            where a.account_code_value_id = %s and a.supplier_party_id = %s
            for update of a
            """,
            (account_code_value_id, supplier_party_id),
        )
        row = cursor.fetchone()
        if row is None:
            return None
        return (int(row[0]), int(row[1]), str(row[2]))

    @staticmethod
    def _verify_existing(
        existing: tuple[int, int, str],
        *,
        supplier: SupplierAccountProjection,
    ) -> ResolvedSupplier:
        """이미 있는 `(계정, party)` 짝은 값을 다시 쓰지 않고 어긋남만 본다.

        사업자번호 비교는 여기서 하지 않는다. 짝으로 찾았으므로 party는 정의상 일치한다. 남은 어긋남은
        같은 계정 코드를 다른 소스가 쓰는 경우뿐이고, 그것은 코드 체계를 섞는 것이라 여전히 막는다
        (AGENTS 6항).
        """
        account_id, party_id, source_system = existing
        if source_system != supplier.source_system:
            raise ProjectionContractError("persisted supplier account source differs")
        return ResolvedSupplier(
            source_supplier_account_id=account_id, supplier_party_id=party_id
        )

    @staticmethod
    def _resolve_party(
        cursor: psycopg.Cursor[Any],
        *,
        business_number_code_value_id: int | None,
        allow_insert: bool,
    ) -> tuple[int, int]:
        """사업자번호가 있으면 그것이 party의 유일 키이고, 없으면 이 관측이 자기 party를 갖는다.

        `allow_insert`가 거짓인 검증 경로에서는 새 party를 만들지 않는다. 없으면 발행된 것과 다르다는
        뜻이므로 그대로 어긋남으로 올린다.
        """
        if not allow_insert:
            if business_number_code_value_id is None:
                raise ProjectionContractError("published supplier party is missing")
            cursor.execute(
                """
                select supplier_party_id from core.supplier_party
                where business_number_code_value_id = %s
                """,
                (business_number_code_value_id,),
            )
            found = cursor.fetchone()
            if found is None:
                raise ProjectionContractError("published supplier party is missing")
            return int(found[0]), 0
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
