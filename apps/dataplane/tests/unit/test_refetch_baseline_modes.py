from __future__ import annotations

from eatbid.pipeline.refetch_baseline import baseline_run_modes


def test_정시_수집의_기준에는_결과_줄_release가_들어가지_않는다() -> None:
    # 결과 줄 release는 목록 전부를 담지만 상세는 상태가 바뀐 공고만 불렀다. 그 신호가 정시 수집 기준이 되면 투찰 수만
    # 바뀐 공고를 다음 정시 수집이 unchanged로 보고 놓친다.
    assert baseline_run_modes("poll-open") == ("poll-open", "daily-reconcile")
    assert baseline_run_modes("daily-reconcile") == ("poll-open", "daily-reconcile")


def test_결과_줄의_기준은_자기_release까지_포함한다() -> None:
    # 자기 release를 빼면 정시 수집이 새 기준을 봉인하기 전까지(성수기 몇 시간) 이미 받은 낙찰 공고를 5분마다 다시 부른다.
    assert baseline_run_modes("poll-results") == ("poll-open", "daily-reconcile", "poll-results")
