from __future__ import annotations

from datetime import datetime


def validate_stage_timestamps(
    *,
    started_at: datetime,
    normalized_at: datetime,
    validated_at: datetime,
    activated_at: datetime,
) -> None:
    values = (
        ("started_at", started_at),
        ("normalized_at", normalized_at),
        ("validated_at", validated_at),
        ("activated_at", activated_at),
    )
    for field, value in values:
        if not isinstance(value, datetime):
            raise TypeError(f"{field} must be a datetime")
        if value.utcoffset() is None:
            raise ValueError(f"{field} must be timezone-aware")
    if not started_at <= normalized_at <= validated_at <= activated_at:
        raise ValueError("pipeline stage timestamps must be monotonic")
