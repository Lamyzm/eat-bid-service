from __future__ import annotations

import pytest
from hypothesis import given
from hypothesis import strategies as st

from eatbid.ingest.publication_repository import QuarantinedRecord
from eatbid.pipeline.exclusion_scope import (
    RECORD_SCOPED_REASONS,
    allowed_exclusions,
    record_scoped_reason_code,
)
from eatbid.pipeline.validate import WindowDefect, validate_completeness

# 레코드 범위로 열거된 실제 격리 문장 하나다(`source/eat/xml.py`의 문구 그대로).
BROKEN_XML = "unsafe or malformed Nexacro XML: not well-formed (invalid token): line 1"


def _격리(*observation_ids: int, reason: str = BROKEN_XML) -> tuple[QuarantinedRecord, ...]:
    return tuple(
        QuarantinedRecord(observation_id=observation_id, reason=reason)
        for observation_id in observation_ids
    )


def _기본값(**overrides: object) -> dict[str, object]:
    values: dict[str, object] = {
        "request_counts": ((1, 1),),
        "expected_count": 1,
        "normalized": 1,
        "quarantined": (),
        "duplicate_source_entities": 0,
        "missing_code_schemes": (),
        "schema_contract_violations": 0,
    }
    values.update(overrides)
    return values


def test_tot_count가_다르면_publication을_거부한다() -> None:
    report = validate_completeness(**_기본값(request_counts=((2, 1),)))  # type: ignore[arg-type]

    assert report.publishable is False
    assert report.failure_category == "SOURCE_CONTRACT"


@given(
    request_counts=st.lists(
        st.tuples(st.integers(min_value=0, max_value=20), st.integers(min_value=0, max_value=20)),
        max_size=8,
    ),
    normalized=st.integers(min_value=0, max_value=100),
    duplicates=st.integers(min_value=0, max_value=10),
    missing=st.lists(st.sampled_from(["a", "b", "c"]), unique=True, max_size=3),
    schema_contract_violations=st.integers(min_value=0, max_value=10),
)
def test_격리가_없으면_완결_판정은_ADR_0061_이전의_등식과_같다(
    request_counts: list[tuple[int, int]],
    normalized: int,
    duplicates: int,
    missing: list[str],
    schema_contract_violations: int,
) -> None:
    expected = (
        all(expected == observed for expected, observed in request_counts)
        and sum(observed for _, observed in request_counts) == normalized
        and duplicates == 0
        and not missing
        and schema_contract_violations == 0
    )

    report = validate_completeness(
        request_counts=tuple(request_counts),
        expected_count=normalized,
        normalized=normalized,
        quarantined=(),
        duplicate_source_entities=duplicates,
        missing_code_schemes=tuple(missing),
        schema_contract_violations=schema_contract_violations,
    )

    assert report.publishable is expected
    assert report.failure_category is (None if expected else "SOURCE_CONTRACT")
    assert report.exclusions == ()


@pytest.mark.parametrize(
    ("expected_count", "allowed"),
    [
        (0, 1),
        (1, 1),
        (50, 1),
        (199, 1),
        (200, 2),
        (4_999, 49),
        (5_000, 50),
        (16_000, 50),
        (19_000, 50),
    ],
)
def test_허용_수는_기대의_1퍼센트를_내리되_하한_1_상한_50이다(
    expected_count: int, allowed: int
) -> None:
    assert allowed_exclusions(expected_count) == allowed


@pytest.mark.parametrize("value", [-1, True, 1.5])
def test_허용_수는_음수나_정수가_아닌_기대_수를_거부한다(value: object) -> None:
    with pytest.raises(ValueError):
        allowed_exclusions(value)  # type: ignore[arg-type]


def test_상한_안의_레코드_범위_격리는_제외로_넘기고_발행한다() -> None:
    report = validate_completeness(
        **_기본값(
            request_counts=((16_000, 16_000),),
            expected_count=16_000,
            normalized=15_950,
            quarantined=_격리(*range(1, 51)),
        )  # type: ignore[arg-type]
    )

    assert report.publishable is True
    assert report.failure_category is None
    assert [item.observation_id for item in report.exclusions] == list(range(1, 51))
    assert {item.reason_code for item in report.exclusions} == {"SOURCE_XML_BROKEN"}
    assert report.exclusions[0].reason == BROKEN_XML


def test_상한을_하나라도_넘으면_레코드_범위여도_발행_전체를_막는다() -> None:
    report = validate_completeness(
        **_기본값(
            request_counts=((16_000, 16_000),),
            expected_count=16_000,
            normalized=15_949,
            quarantined=_격리(*range(1, 52)),
        )  # type: ignore[arg-type]
    )

    assert report.publishable is False
    assert report.exclusions == ()
    assert report.window_defects == (WindowDefect.EXCLUSION_CAP_EXCEEDED,)


def test_기대_50건이면_하나만_뺄_수_있다() -> None:
    하나 = validate_completeness(
        **_기본값(
            request_counts=((50, 50),),
            expected_count=50,
            normalized=49,
            quarantined=_격리(7),
        )  # type: ignore[arg-type]
    )
    둘 = validate_completeness(
        **_기본값(
            request_counts=((50, 50),),
            expected_count=50,
            normalized=48,
            quarantined=_격리(7, 8),
        )  # type: ignore[arg-type]
    )

    assert 하나.publishable is True
    assert 둘.publishable is False


@pytest.mark.parametrize(
    ("overrides", "defect"),
    [
        ({"request_counts": ((3, 2),)}, WindowDefect.REQUEST_COUNT_MISMATCH),
        ({"normalized": 1}, WindowDefect.UNSETTLED_OBSERVATIONS),
        ({"duplicate_source_entities": 1}, WindowDefect.DUPLICATE_SOURCE_ENTITY),
        ({"missing_code_schemes": ("eat:organization",)}, WindowDefect.MISSING_CODE_SCHEME),
        ({"schema_contract_violations": 1}, WindowDefect.SOURCE_CONTRACT),
        (
            {"quarantined": _격리(9, reason="synthetic drift nobody enumerated")},
            WindowDefect.UNCLASSIFIED_QUARANTINE,
        ),
    ],
)
def test_창_전체_결함이_있으면_상한_안의_격리도_제외되지_않는다(
    overrides: dict[str, object], defect: WindowDefect
) -> None:
    """격리 하나(허용 수 안)와 창 전체 결함 하나가 같이 있을 때 결함이 이긴다(ADR 0061 결정 2)."""
    values = _기본값(
        request_counts=((3, 3),),
        expected_count=3,
        normalized=2,
        quarantined=_격리(9),
    )
    values.update(overrides)

    report = validate_completeness(**values)  # type: ignore[arg-type]

    assert report.publishable is False
    assert report.failure_category == "SOURCE_CONTRACT"
    assert report.exclusions == ()
    assert defect in report.window_defects


def test_열거되지_않은_격리_사유는_기본값으로_창_전체_실패다() -> None:
    assert record_scoped_reason_code("planned ELCTRN_BID_ID is required") is None
    assert record_scoped_reason_code("") is None
    assert record_scoped_reason_code(BROKEN_XML) == "SOURCE_XML_BROKEN"
    assert (
        record_scoped_reason_code("invalid eaT detail field: 1 validation error")
        == "RECORD_CONTRACT_VIOLATION"
    )


def test_레코드_범위_분류표는_머리가_겹치지_않고_코드가_비어_있지_않다() -> None:
    prefixes = [prefix for prefix, _ in RECORD_SCOPED_REASONS]

    assert len(prefixes) == len(set(prefixes))
    assert all(code and code == code.upper() for _, code in RECORD_SCOPED_REASONS)


def test_같은_관측의_격리가_두_번_오면_거부한다() -> None:
    with pytest.raises(ValueError):
        validate_completeness(
            **_기본값(
                request_counts=((2, 2),),
                expected_count=2,
                normalized=0,
                quarantined=_격리(1, 1),
            )  # type: ignore[arg-type]
        )


@pytest.mark.parametrize(
    "kwargs",
    [
        {"request_counts": ((-1, 0),)},
        {"expected_count": -1},
        {"normalized": -1},
        {"duplicate_source_entities": -1},
        {"schema_contract_violations": -1},
    ],
)
def test_completeness가_음수_counts을_거부한다(kwargs: dict[str, object]) -> None:
    values = _기본값(request_counts=(), expected_count=0, normalized=0)
    values.update(kwargs)

    with pytest.raises(ValueError):
        validate_completeness(**values)  # type: ignore[arg-type]
