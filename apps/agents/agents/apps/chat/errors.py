"""Chat domain exceptions mapped to HTTP status codes."""

from __future__ import annotations

from dataclasses import dataclass
from typing import ClassVar


@dataclass(slots=True)
class AgentException(Exception):  # noqa: N818 - domain-specific base name
    """Base class for chat domain errors."""

    message: str
    http_status: ClassVar[int] = 500
    code: ClassVar[str] = "INTERNAL_ERROR"

    def __post_init__(self) -> None:
        Exception.__init__(self, self.message)


class InvalidPayloadError(AgentException):
    http_status = 422
    code = "INVALID_PAYLOAD"


class ProviderError(AgentException):
    http_status = 502
    code = "PROVIDER_ERROR"


class UnauthorizedError(AgentException):
    http_status = 401
    code = "UNAUTHORIZED"
