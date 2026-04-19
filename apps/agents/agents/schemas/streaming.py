"""Server-Sent Event payload models emitted by POST /api/v1/generate."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class TokenEvent(BaseModel):
    type: Literal["token"] = "token"
    text: str


class HeartbeatEvent(BaseModel):
    type: Literal["heartbeat"] = "heartbeat"


class DoneEvent(BaseModel):
    type: Literal["done"] = "done"


class ErrorEvent(BaseModel):
    type: Literal["error"] = "error"
    code: str
    message: str


class ServerEvent:
    """Factory helpers for the SSE event models.

    Each event is its own pydantic model (for schema export); the wire
    format is `{"type": "...", ...}`. Factories are convenience
    constructors used by the /generate handler.
    """

    @staticmethod
    def token(text: str) -> TokenEvent:
        return TokenEvent(text=text)

    @staticmethod
    def heartbeat() -> HeartbeatEvent:
        return HeartbeatEvent()

    @staticmethod
    def done() -> DoneEvent:
        return DoneEvent()

    @staticmethod
    def error(code: str, message: str) -> ErrorEvent:
        return ErrorEvent(code=code, message=message)
