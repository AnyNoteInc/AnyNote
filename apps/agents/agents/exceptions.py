"""Domain exception hierarchy mapped to HTTP status + machine codes."""

from __future__ import annotations


class AgentException(Exception):  # noqa: N818 - domain-specific base name
    """Base class for agent domain errors."""

    http_status: int = 500
    code: str = "INTERNAL_ERROR"


class InvalidPayloadError(AgentException):
    http_status = 400
    code = "INVALID_PAYLOAD"


class AuthError(AgentException):
    http_status = 401
    code = "UNAUTHORIZED"


class ThreadLockedError(AgentException):
    http_status = 409
    code = "THREAD_LOCKED"


class ProviderError(AgentException):
    http_status = 502
    code = "PROVIDER_ERROR"
