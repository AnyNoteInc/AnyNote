"""Shared enum definitions for chat payloads."""

from __future__ import annotations

from enum import StrEnum


class ModelProvider(StrEnum):
    ollama = "ollama"
    openai = "openai"
    gigachat = "gigachat"
