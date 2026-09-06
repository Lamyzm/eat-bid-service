from __future__ import annotations

import pytest

from eatbid.errors import SourceContractError, SourceUnavailableError
from eatbid.failure_categories import (
    CONFIGURATION,
    DATA_QUARANTINED,
    SOURCE_CONTRACT,
    SOURCE_THROTTLED,
    TRANSIENT_NETWORK,
)
from eatbid.pipeline.capture import SourceThrottledError
from eatbid.pipeline.chunk import (
    DEFAULT_CHUNK_SIZE,
    run_chunk,
    split_into_chunks,
)
from eatbid.pipeline.normalize import DataQuarantinedError


def _무시(key: str, category: str, error: Exception) -> None:
    return None


def test_chunk는_발견_순서를_유지하고_마지막만_작다() -> None:
    values = tuple(str(number) for number in range(1, 8))

    chunks = split_into_chunks(values, size=3)

    assert chunks == (("1", "2", "3"), ("4", "5", "6"), ("7",))
    assert tuple(value for chunk in chunks for value in chunk) == values


def test_빈_목록은_chunk를_만들지_않고_기본_크기는_50이다() -> None:
    assert split_into_chunks(()) == ()
    assert DEFAULT_CHUNK_SIZE == 50
    assert len(split_into_chunks(tuple(range(120)))) == 3


@pytest.mark.parametrize("size", [0, -1, True])
def test_chunk_크기가_양의_정수가_아니면_거부한다(size: object) -> None:
    with pytest.raises(ValueError, match="chunk size"):
        split_into_chunks(("1",), size=size)  # type: ignore[arg-type]


def test_전송_실패_한_건은_뒤의_건을_막지_않고_그_건만_실패로_남는다() -> None:
    def run_item(key: str) -> str:
        if key == "2":
            raise SourceUnavailableError("host unreachable", attempts=3)
        return f"관측-{key}"

    outcome = run_chunk(("1", "2", "3"), run_item, _무시)

    assert [item.key for item in outcome.attempted] == ["1", "2", "3"]
    assert outcome.skipped == ()
    assert [item.result for item in outcome.succeeded] == ["관측-1", "관측-3"]
    assert [item.failure_category for item in outcome.failed] == [TRANSIENT_NETWORK]


def test_전송_실패가_남은_chunk는_fail_closed_exit_code로_닫힌다() -> None:
    def run_item(key: str) -> str:
        raise SourceUnavailableError("host unreachable", attempts=3)

    outcome = run_chunk(("1",), run_item, _무시)

    assert outcome.exit_code == 69


def test_모든_건이_성공하면_exit_code가_0이다() -> None:
    outcome = run_chunk(("1", "2"), lambda key: key, _무시)

    assert outcome.exit_code == 0
    assert outcome.failed == ()


def test_격리된_파싱_실패는_다음_건을_계속_정규화한다() -> None:
    def run_item(key: str) -> str:
        if key == "1":
            raise DataQuarantinedError(1, "malformed payload")
        return key

    outcome = run_chunk(("1", "2"), run_item, _무시)

    assert [item.key for item in outcome.attempted] == ["1", "2"]
    assert outcome.exit_code == 65
    assert [item.failure_category for item in outcome.failed] == [DATA_QUARANTINED]


@pytest.mark.parametrize(
    ("error", "category", "exit_code"),
    [
        (SourceThrottledError(429), SOURCE_THROTTLED, 75),
        (SourceContractError("schema drift"), SOURCE_CONTRACT, 76),
        (RuntimeError("terminal capture state"), CONFIGURATION, 64),
    ],
)
def test_run을_닫는_실패는_남은_건을_시도하지_않는다(
    error: Exception, category: str, exit_code: int
) -> None:
    attempts: list[str] = []

    def run_item(key: str) -> str:
        attempts.append(key)
        if key == "2":
            raise error
        return key

    outcome = run_chunk(("1", "2", "3", "4"), run_item, _무시)

    assert attempts == ["1", "2"]
    assert outcome.skipped == ("3", "4")
    assert [item.failure_category for item in outcome.failed] == [category]
    assert outcome.exit_code == exit_code


def test_섞인_실패는_먼저_멈춰야_할_범주의_exit_code를_남긴다() -> None:
    def run_item(key: str) -> str:
        if key == "1":
            raise SourceUnavailableError("host unreachable", attempts=3)
        if key == "2":
            raise SourceThrottledError(429)
        return key

    outcome = run_chunk(("1", "2", "3"), run_item, _무시)

    assert {item.failure_category for item in outcome.failed} == {
        TRANSIENT_NETWORK,
        SOURCE_THROTTLED,
    }
    assert outcome.exit_code == 75


def test_건별_실패는_범주와_예외를_보고자에게_한_번씩_넘긴다() -> None:
    reported: list[tuple[str, str, str]] = []
    error = SourceUnavailableError("host unreachable", attempts=3)

    def run_item(key: str) -> str:
        if key == "2":
            raise error
        return key

    run_chunk(
        ("1", "2", "3"),
        run_item,
        lambda key, category, failure: reported.append(
            (key, category, type(failure).__name__)
        ),
    )

    assert reported == [("2", TRANSIENT_NETWORK, "SourceUnavailableError")]
