from typing import Annotated

from fast_clean.settings import (
    CoreDbSettingsSchema,
    CoreServiceSettingsSchema,
    CoreSettingsSchema,
)
from pydantic import Field


class QdrantSettingsSchema(CoreServiceSettingsSchema):
    collection_name: str = 'pages'
    vector_size: int = 768


class OllamaSettingsSchema(CoreServiceSettingsSchema):
    embedding_model: str = 'nomic-embed-text'


class SettingsSchema(CoreSettingsSchema):
    cors_origins: Annotated[list[str], Field(default_factory=list)]
    db: CoreDbSettingsSchema
    qdrant: QdrantSettingsSchema
    ollama: OllamaSettingsSchema


settings = SettingsSchema()  # pyright: ignore[reportCallIssue]  # all fields populated from env
