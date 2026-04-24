from typing import Annotated

from fast_clean.settings import (
    CoreDbSettingsSchema,
    CoreServiceSettingsSchema,
    CoreSettingsSchema,
)
from pydantic import Field, HttpUrl


class QdrantSettingsSchema(CoreServiceSettingsSchema):
    host: HttpUrl | None = None  # type: ignore[assignment]  # parent requires HttpUrl; we use `url` instead
    url: str
    collection_name: str = 'pages'
    vector_size: int = 768


class OllamaSettingsSchema(CoreServiceSettingsSchema):
    host: HttpUrl | None = None  # type: ignore[assignment]  # parent requires HttpUrl; we use `url` instead
    url: str
    embedding_model: str = 'nomic-embed-text'


class SettingsSchema(CoreSettingsSchema):
    cors_origins: Annotated[list[str], Field(default_factory=list)]
    db: CoreDbSettingsSchema
    qdrant: QdrantSettingsSchema
    ollama: OllamaSettingsSchema


settings = SettingsSchema()  # pyright: ignore[reportCallIssue]  # all fields populated from env
