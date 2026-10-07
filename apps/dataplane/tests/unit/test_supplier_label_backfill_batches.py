"""업체명 채우기의 묶음 크기가 고친 행 수를 보고 스스로 맞춰지는지 확인한다(EAT-310)."""

from __future__ import annotations

from eatbid.core.supplier_label_backfill import next_batch_size


def test_목표의_절반에_못_미치면_다음_묶음의_업체_수를_두_배로_늘린다() -> None:
    assert next_batch_size(32, rows_filled=10, target_rows=200_000) == 64


def test_목표의_두_배를_넘으면_다음_묶음의_업체_수를_반으로_줄인다() -> None:
    assert next_batch_size(32, rows_filled=500_000, target_rows=200_000) == 16


def test_목표_근처면_업체_수를_그대로_둔다() -> None:
    assert next_batch_size(32, rows_filled=200_000, target_rows=200_000) == 32


def test_업체_수는_한_곳_아래로도_상한_위로도_가지_않는다() -> None:
    assert next_batch_size(1, rows_filled=10_000_000, target_rows=1) == 1
    assert next_batch_size(1_024, rows_filled=0, target_rows=200_000) == 1_024
