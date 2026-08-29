from __future__ import annotations


class SourceContractError(RuntimeError):
    """The source response violates a contract required for safe processing."""

    def __init__(self, message: str, *, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code
