"""모듈 책임: source release PostgreSQL constraint와 transaction state를 typed error로 변환한다."""

from __future__ import annotations

from typing import Literal, NoReturn

import psycopg
from psycopg import IsolationLevel
from psycopg.pq import TransactionStatus

from eatbid.ingest.release_repository import (
    ReleaseDuplicateMemberError,
    ReleaseIsolationContractError,
    ReleaseMissingMemberError,
    ReleasePlanConflictError,
)

MemberKind = Literal["run", "observation"]

_MEMBER_FOREIGN_KEYS = {
    "run": "source_release_run_run_id_run_run_id_fkey",
    "observation": "source_release_observation_In0Vbhr12fDW_fkey",
}
_MEMBER_PRIMARY_KEYS = {
    "run": "source_release_run_pkey",
    "observation": "source_release_observation_pkey",
}


def require_terminal_scope(connection: psycopg.Connection[object]) -> None:
    if connection.info.transaction_status != TransactionStatus.IDLE:
        raise ReleaseIsolationContractError(
            "source release seal requires an idle repository connection"
        )
    configured = connection.isolation_level
    if configured not in {None, IsolationLevel.READ_COMMITTED}:
        raise ReleaseIsolationContractError(
            "source release seal requires READ COMMITTED connection isolation"
        )


def raise_plan_conflict(error: psycopg.errors.UniqueViolation) -> NoReturn:
    constraint = error.diag.constraint_name
    if constraint == "source_release_pkey":
        raise ReleasePlanConflictError("source_release_id") from error
    if constraint == "source_release_source_release_name_key":
        raise ReleasePlanConflictError("source_release_name") from error
    raise error


def raise_missing_member(
    error: psycopg.errors.ForeignKeyViolation, member_kind: MemberKind
) -> NoReturn:
    if error.diag.constraint_name != _MEMBER_FOREIGN_KEYS[member_kind]:
        raise error
    raise ReleaseMissingMemberError(member_kind) from error


def raise_duplicate_member(
    error: psycopg.errors.UniqueViolation, member_kind: MemberKind
) -> NoReturn:
    if error.diag.constraint_name != _MEMBER_PRIMARY_KEYS[member_kind]:
        raise error
    raise ReleaseDuplicateMemberError(
        f"source release {member_kind} member already exists"
    ) from error
