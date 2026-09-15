from __future__ import annotations

from typing import get_args

from eatbid.ingest.repository import (
    CaptureRunMode,
    CodeVocabularyRunMode,
    CollectionRunMode,
    ReferenceRunMode,
)
from eatbid.pipeline.collection_window import COLLECTION_MODES


def test_run_mode_목록_넷이_서로_어긋나지_않는다() -> None:
    assert set(get_args(CaptureRunMode)) == (
        set(get_args(CollectionRunMode))
        | set(get_args(ReferenceRunMode))
        | set(get_args(CodeVocabularyRunMode))
    )


def test_창을_번역하는_모드에는_창_없는_실행이_들어오지_않는다() -> None:
    assert COLLECTION_MODES == get_args(CollectionRunMode)
    assert "reference" not in COLLECTION_MODES
    assert "code-vocabulary" not in COLLECTION_MODES
