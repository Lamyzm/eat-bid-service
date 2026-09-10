"""모듈 책임: 운영 기대의 선언·판정·알림을 한 곳에 모아 조용한 멈춤이 사람에게 도달하게 한다(ADR 0046 결정 5·6)."""

from .expectations import EXPECTATIONS, Expectation, Violation, evaluate
from .notify import format_message, format_resolution
from .state import OpenViolation, diff_violations

__all__ = [
    "EXPECTATIONS",
    "Expectation",
    "OpenViolation",
    "Violation",
    "diff_violations",
    "evaluate",
    "format_message",
    "format_resolution",
]
