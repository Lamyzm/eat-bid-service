from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

import psycopg
import pytest

from eatbid.core.code_release_projection import project_code_release
from eatbid.core.repository import ProjectionContractError
from eatbid.source.reference.mois_parser import parse_legal_dong_release
from eatbid.source.reference.source_contracts import (
    LEGAL_DONG_DATASET,
    MOIS_STANDARD_CODE,
    decode_reference_payload,
    reference_dataset_contract,
)

from .conftest import MigratedDatabase

SAMPLE_PATH = Path(__file__).parents[1] / "fixtures" / "reference" / "mois-legal-dong-sample.txt"
OBSERVED_AT = datetime(2026, 9, 6, 3, 19, 24, tzinfo=UTC)


def _release(source_version: str = "2026-09-06"):
    contract = reference_dataset_contract(MOIS_STANDARD_CODE, LEGAL_DONG_DATASET)
    rows = decode_reference_payload(SAMPLE_PATH.read_bytes(), contract=contract)
    return parse_legal_dong_release(
        rows, contract=contract, source_id=MOIS_STANDARD_CODE, source_version=source_version
    )


def _seal_source_release(
    cursor: psycopg.Cursor[Any], *, sealed: bool = True
) -> tuple[UUID, int]:
    """봉인된 원본 입력 하나와 그 근거 observation을 만든다."""
    run_id = uuid4()
    source_release_id = uuid4()
    blob_sha256 = uuid4().hex + uuid4().hex
    cursor.execute(
        """
        insert into ingest.run (
            run_id, mode, status, build_sha, parser_version, started_at,
            expected_count, captured_count, published_count
        ) values (%s, 'reference', 'running', %s, 'mois-v1', %s, 1, 1, 0)
        """,
        (str(run_id), "a" * 64, OBSERVED_AT),
    )
    cursor.execute(
        """
        insert into ingest.request_unit (
            run_id, source, endpoint, request_params, request_params_hash,
            expected_count, observed_count, status
        ) values (%s, %s, 'legal-dong', '{}'::jsonb, %s, 1, 1, 'captured')
        returning request_unit_id
        """,
        (str(run_id), MOIS_STANDARD_CODE, "b" * 64),
    )
    request_unit_id = int(cursor.fetchone()[0])
    cursor.execute(
        """
        insert into ingest.raw_blob (
            content_sha256, object_key, byte_length, content_type, content_encoding, stored_at
        ) values (%s, %s, 1, 'text/plain; charset=cp949', 'gzip', %s)
        """,
        (blob_sha256, f"raw/{MOIS_STANDARD_CODE}/legal-dong/{blob_sha256}.txt.gz", OBSERVED_AT),
    )
    cursor.execute(
        """
        insert into ingest.raw_observation (
            run_id, request_unit_id, source, endpoint, request_params,
            fetched_at, http_status, content_sha256
        ) values (%s, %s, %s, 'legal-dong', '{}'::jsonb, %s, 200, %s)
        returning observation_id
        """,
        (str(run_id), request_unit_id, MOIS_STANDARD_CODE, OBSERVED_AT, blob_sha256),
    )
    observation_id = int(cursor.fetchone()[0])
    cursor.execute(
        """
        insert into ingest.source_release (
            source_release_id, source, release_name, status, as_of
        ) values (%s, %s, %s, 'planned', %s)
        """,
        (str(source_release_id), MOIS_STANDARD_CODE, f"legal-dong {source_release_id}", OBSERVED_AT),
    )
    cursor.execute(
        """
        insert into ingest.source_release_dataset (
            source_release_id, endpoint, dataset, record_type, parser_version,
            schema_fingerprint, expected_count, observed_count, normalized_count,
            quarantined_count, required
        ) values (%s, '/etc/codeFullDown.do', %s, 'code-release', 'mois-v1', %s, 1, 1, 1, 0, true)
        """,
        (str(source_release_id), LEGAL_DONG_DATASET, uuid4().hex + uuid4().hex),
    )
    cursor.execute(
        "insert into ingest.source_release_run (source_release_id, run_id) values (%s, %s)",
        (str(source_release_id), str(run_id)),
    )
    if sealed:
        # 봉인은 planned에서만 넘어갈 수 있다. 상태 전이 trigger가 그것을 강제하므로 테스트도
        # 실행 경로와 같은 순서를 밟는다.
        cursor.execute(
            """
            update ingest.source_release
            set status = 'sealed', manifest_sha256 = %s, sealed_at = %s
            where source_release_id = %s
            """,
            (uuid4().hex + uuid4().hex, OBSERVED_AT, str(source_release_id)),
        )
    return source_release_id, observation_id


@pytest.fixture
def connection(migrated_db: MigratedDatabase):
    with migrated_db.connect() as connection:
        yield connection
        connection.rollback()


def test_봉인되지_않은_입력으로는_canonical_코드를_공개하지_않는다(connection) -> None:
    with connection.cursor() as cursor:
        source_release_id, observation_id = _seal_source_release(cursor, sealed=False)
        with pytest.raises(ProjectionContractError):
            project_code_release(
                cursor,
                _release(),
                source_release_id=source_release_id,
                observation_id=observation_id,
                observed_at=OBSERVED_AT,
            )
    connection.rollback()


def test_release_투영이_코드와_라벨과_계층을_함께_앉힌다(connection) -> None:
    with connection.cursor() as cursor:
        source_release_id, observation_id = _seal_source_release(cursor)
        release = _release()
        result = project_code_release(
            cursor,
            release,
            source_release_id=source_release_id,
            observation_id=observation_id,
            observed_at=OBSERVED_AT,
        )
        assert result.member_count == len(release.members)
        assert result.already_projected is False
        cursor.execute(
            """
            select v.code, m.grain, m.active, p.code
            from core.code_release_member m
            join core.code_value v on v.code_value_id = m.code_value_id
            left join core.code_value p on p.code_value_id = m.parent_code_value_id
            where m.code_release_id = %s
            order by v.code
            """,
            (result.code_release_id,),
        )
        rows = {row[0]: (row[1], row[2], row[3]) for row in cursor.fetchall()}
        assert rows["1111000000"] == ("sigungu", True, "1100000000")
        assert rows["4111100000"] == ("sigungu", True, "4111000000")
        assert rows["2900000000"] == ("sido", False, None)
        assert rows["3611000000"][2] is None
        cursor.execute(
            "select count(*) from core.code_label_observation where observation_id = %s",
            (observation_id,),
        )
        assert cursor.fetchone()[0] == len(release.members)
    connection.rollback()


def test_같은_파일을_두_번_투영해도_member가_늘지_않는다(connection) -> None:
    with connection.cursor() as cursor:
        source_release_id, observation_id = _seal_source_release(cursor)
        first = project_code_release(
            cursor,
            _release(),
            source_release_id=source_release_id,
            observation_id=observation_id,
            observed_at=OBSERVED_AT,
        )
        second = project_code_release(
            cursor,
            _release(),
            source_release_id=source_release_id,
            observation_id=observation_id,
            observed_at=OBSERVED_AT,
        )
        assert second.code_release_id == first.code_release_id
        assert second.already_projected is True
        assert second.inserted_code_values == 0
        cursor.execute(
            "select count(*) from core.code_release_member where code_release_id = %s",
            (first.code_release_id,),
        )
        assert cursor.fetchone()[0] == first.member_count
    connection.rollback()


def test_정정_파일은_새_release이며_기존_member를_수정하지_않는다(connection) -> None:
    with connection.cursor() as cursor:
        first_release_id, first_observation_id = _seal_source_release(cursor)
        first = project_code_release(
            cursor,
            _release(),
            source_release_id=first_release_id,
            observation_id=first_observation_id,
            observed_at=OBSERVED_AT,
        )
        second_release_id, second_observation_id = _seal_source_release(cursor)
        corrected = _release(source_version="2026-10-01")
        second = project_code_release(
            cursor,
            corrected,
            source_release_id=second_release_id,
            observation_id=second_observation_id,
            observed_at=OBSERVED_AT,
        )
        assert second.code_release_id != first.code_release_id
        # 두 번째 release는 같은 code_value를 재사용하고 새로 만들지 않는다. 정체성은 영구적이다.
        assert second.inserted_code_values == 0
        cursor.execute("select count(*) from core.code_release")
        assert cursor.fetchone()[0] == 2
        cursor.execute(
            "select source_version from core.code_release where code_release_id = %s",
            (first.code_release_id,),
        )
        assert cursor.fetchone()[0] == "2026-09-06"
    connection.rollback()


def test_release_행은_무엇을_뺐는지를_기록한다(connection) -> None:
    with connection.cursor() as cursor:
        source_release_id, observation_id = _seal_source_release(cursor)
        release = _release()
        result = project_code_release(
            cursor,
            release,
            source_release_id=source_release_id,
            observation_id=observation_id,
            observed_at=OBSERVED_AT,
        )
        cursor.execute(
            """
            select promoted_grain, source_row_count, member_count, excluded_row_count
            from core.code_release where code_release_id = %s
            """,
            (result.code_release_id,),
        )
        promoted_grain, source_rows, members, excluded = cursor.fetchone()
        assert promoted_grain == ["sido", "sigungu"]
        assert source_rows == release.source_row_count
        assert members + excluded == source_rows
    connection.rollback()
