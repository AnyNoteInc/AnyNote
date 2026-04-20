"""Chat domain exceptions mapped to HTTP status codes."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(slots=True)
class AgentException(Exception):  # noqa: N818 - domain-specific base name
    code: str
    message: str
    http_status: int

    def __str__(self) -> str:
        return self.message


class InvalidPayloadError(AgentException):
    def __init__(self, message: str) -> None:
        super().__init__(code="INVALID_PAYLOAD", message=message, http_status=422)


class ProviderError(AgentException):
    def __init__(self, message: str, *, code: str = "PROVIDER_ERROR") -> None:
        super().__init__(code=code, message=message, http_status=502)


class UnauthorizedError(AgentException):
    def __init__(self) -> None:
        super().__init__(
            code="UNAUTHORIZED",
            message="Invalid bearer token",
            http_status=401,
        )
