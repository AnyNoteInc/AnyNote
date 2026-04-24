from typing import Annotated, Any

from fast_clean.settings import (
    CoreDbSettingsSchema,
    CoreServiceSettingsSchema,
    CoreSettingsSchema,
)
from pydantic import Field, model_validator


class QdrantSettingsSchema(CoreServiceSettingsSchema):
    url: str
    collection_name: str = 'pages'
    vector_size: int = 768


class OllamaSettingsSchema(CoreServiceSettingsSchema):
    url: str
    embedding_model: str = 'nomic-embed-text'

class SettingsSchema(CoreSettingsSchema):
    cors_origins: Annotated[list[str], Field(default_factory=list)]
    db: CoreDbSettingsSchema
    qdrant: QdrantSettingsSchema
    ollama: OllamaSettingsSchema


settings = SettingsSchema() # type: ignore
