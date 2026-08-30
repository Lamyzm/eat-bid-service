from __future__ import annotations

import pytest
from hypothesis import given
from hypothesis import strategies as st

from eatbid.pipeline.validate import validate_completeness


def test_publication는_거부된다_일_때_tot_count_differs이다() -> None:
    report = validate_completeness(
        request_counts=((2, 1),),
        normalized=1,
        quarantined=0,
        duplicate_source_entities=0,
        missing_code_schemes=(),
        schema_contract_violations=0,
    )

    assert report.publishable is False
    assert report.failure_category == "SOURCE_CONTRACT"


@given(
    request_counts=st.lists(
        st.tuples(st.integers(min_value=0, max_value=20), st.integers(min_value=0, max_value=20)),
        max_size=8,
    ),
    normalized=st.integers(min_value=0, max_value=100),
    quarantined=st.integers(min_value=0, max_value=10),
    duplicates=st.integers(min_value=0, max_value=10),
    missing=st.lists(st.sampled_from(["a", "b", "c"]), unique=True, max_size=3),
    schema_contract_violations=st.integers(min_value=0, max_value=10),
)
def test_completeness가_정확한_gate_equation을_일치시킨다(
    request_counts: list[tuple[int, int]],
    normalized: int,
    quarantined: int,
    duplicates: int,
    missing: list[str],
    schema_contract_violations: int,
) -> None:
    expected = (
        all(expected == observed for expected, observed in request_counts)
        and sum(observed for _, observed in request_counts) == normalized
        and quarantined == 0
        and duplicates == 0
        and not missing
        and schema_contract_violations == 0
    )

    report = validate_completeness(
        request_counts=tuple(request_counts),
        normalized=normalized,
        quarantined=quarantined,
        duplicate_source_entities=duplicates,
        missing_code_schemes=tuple(missing),
        schema_contract_violations=schema_contract_violations,
    )

    assert report.publishable is expected
    assert report.failure_category is (None if expected else "SOURCE_CONTRACT")


@pytest.mark.parametrize(
    "overrides",
    [
        {"request_counts": ((1, 0),), "normalized": 0},
        {"request_counts": ((1, 1),), "normalized": 0},
        {"quarantined": 1},
        {"duplicate_source_entities": 1},
        {"missing_code_schemes": ("eat:organization",)},
        {"schema_contract_violations": 1},
    ],
)
def test_each_completeness_failure_mode가_publication을_차단한다(
    overrides: dict[str, object],
) -> None:
    values: dict[str, object] = {
        "request_counts": ((1, 1),),
        "normalized": 1,
        "quarantined": 0,
        "duplicate_source_entities": 0,
        "missing_code_schemes": (),
        "schema_contract_violations": 0,
    }
    values.update(overrides)

    assert validate_completeness(**values).publishable is False  # type: ignore[arg-type]


@pytest.mark.parametrize(
    "kwargs",
    [
        {"request_counts": ((-1, 0),)},
        {"normalized": -1},
        {"quarantined": -1},
        {"duplicate_source_entities": -1},
        {"schema_contract_violations": -1},
    ],
)
def test_completeness가_음수_counts을_거부한다(kwargs: dict[str, object]) -> None:
    values: dict[str, object] = {
        "request_counts": (),
        "normalized": 0,
        "quarantined": 0,
        "duplicate_source_entities": 0,
        "missing_code_schemes": (),
        "schema_contract_violations": 0,
    }
    values.update(kwargs)

    with pytest.raises(ValueError):
        validate_completeness(**values)  # type: ignore[arg-type]
