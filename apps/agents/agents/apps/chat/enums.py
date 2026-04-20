"""Shared enum definitions for chat payloads."""

from __future__ import annotations

from enum import StrEnum


class ModelProvider(StrEnum):
    OLLAMA = "ollama"
    OPENAI = "openai"
    GIGACHAT = "gigachat"
