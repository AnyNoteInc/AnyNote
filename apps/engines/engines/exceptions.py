"""Engines exception hierarchy."""

from __future__ import annotations


class EnginesError(Exception):
    code: str = "INTERNAL_ERROR"


class ToolError(EnginesError):
    code = "TOOL_ERROR"


class AuthError(EnginesError):
    code = "UNAUTHORIZED"
