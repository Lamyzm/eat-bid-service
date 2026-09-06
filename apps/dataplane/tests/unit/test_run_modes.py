from __future__ import annotations

from typing import get_args

from eatbid.ingest.repository import (
    CaptureRunMode,
    CollectionRunMode,
    ReferenceRunMode,
)
from eatbid.pipeline.collection_window import COLLECTION_MODES


def test_run_mode_목록_셋이_서로_어긋나지_않는다() -> None:
    assert set(get_args(CaptureRunMode)) == set(get_args(CollectionRunMode)) | set(
        get_args(ReferenceRunMode)
    )


def test_창을_번역하는_모드에는_reference가_들어오지_않는다() -> None:
    assert COLLECTION_MODES == get_args(CollectionRunMode)
    assert "reference" not in COLLECTION_MODES
