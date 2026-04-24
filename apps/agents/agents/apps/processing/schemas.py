from typing import Literal


from pydantic import BaseModel, Field

Language = Literal["ru", "en", "auto"]
DetectedLanguage = Literal["ru", "en"]


class NormalizeRequestSchema(BaseModel):
    text: str = Field(..., description="Raw text to normalize.")
    language: Language = Field("auto", description="Source language or 'auto'.")


class NormalizeResponseSchema(BaseModel):
    chunks: list[str] = Field(
        ...,
        description='Normalized text chunks ready for embedding.',
    )
    language: DetectedLanguage = Field(..., description="Language used for pipeline.")
