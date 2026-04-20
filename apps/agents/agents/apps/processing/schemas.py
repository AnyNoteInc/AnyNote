"""Processing module request/response schemas."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Language = Literal["ru", "en", "auto"]
DetectedLanguage = Literal["ru", "en"]


class NormalizeRequest(BaseModel):
    text: str = Field(..., description="Raw text to normalize.")
    language: Language = Field("auto", description="Source language or 'auto'.")


class NormalizeResponse(BaseModel):
    normalized: str = Field(..., description="Pipeline output ready for embedding.")
    language: DetectedLanguage = Field(..., description="Language used for pipeline.")
