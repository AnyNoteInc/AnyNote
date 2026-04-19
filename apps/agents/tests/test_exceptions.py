"""Unit tests for the AgentException hierarchy."""

from __future__ import annotations

from agents.exceptions import (
    AgentException,
    AuthError,
    InvalidPayloadError,
    ProviderError,
    ThreadLockedError,
)


def test_agent_exception_defaults() -> None:
    assert AgentException.http_status == 500
    assert AgentException.code == "INTERNAL_ERROR"


def test_invalid_payload_error() -> None:
    e = InvalidPayloadError("bad field")
    assert e.http_status == 400
    assert e.code == "INVALID_PAYLOAD"
    assert str(e) == "bad field"


def test_auth_error() -> None:
    assert AuthError.http_status == 401
    assert AuthError.code == "UNAUTHORIZED"


def test_thread_locked_error() -> None:
    assert ThreadLockedError.http_status == 409
    assert ThreadLockedError.code == "THREAD_LOCKED"


def test_provider_error() -> None:
    assert ProviderError.http_status == 502
    assert ProviderError.code == "PROVIDER_ERROR"


def test_inheritance() -> None:
    assert issubclass(InvalidPayloadError, AgentException)
    assert issubclass(AuthError, AgentException)
    assert issubclass(ProviderError, AgentException)
    assert issubclass(ThreadLockedError, AgentException)
